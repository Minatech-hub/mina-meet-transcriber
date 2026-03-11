import { Message, MeetingData, CaptionEntry, ExtensionState } from "@/lib/types";
import { getState, saveState, getCurrentMeeting, saveCurrentMeeting } from "@/lib/storage";
import { saveTranscription, requestSummarize } from "@/lib/api";

/**
 * Service Worker (Manifest V3) — gerencia o estado global da extensao.
 *
 * Responsabilidades:
 * - Acumular entradas de legendas no chrome.storage.local
 * - Detectar inicio/fim de reuniao
 * - Enviar transcricao para o backend quando a reuniao termina
 * - Manter-se vivo durante reunioes via chrome.alarms
 */

const KEEPALIVE_ALARM = "mina-meet-keepalive";

// ========== Handlers de Mensagens ==========

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  handleMessage(msg).then((response) => {
    sendResponse(response);
  });
  return true; // manter canal aberto para resposta async
});

async function handleMessage(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case "MEETING_STARTED":
      return handleMeetingStarted(msg.data);
    case "MEETING_ENDED":
      return handleMeetingEnded();
    case "CAPTION_CAPTURED":
      return handleCaptionCaptured(msg.data);
    case "PARTICIPANT_DETECTED":
      return handleParticipantDetected(msg.data);
    case "GET_STATE":
      return getState();
    case "SEND_NOW":
      return handleSendNow();
    default:
      return { ok: true };
  }
}

async function handleMeetingStarted(data: { meetId: string; title: string; meetUrl: string }): Promise<void> {
  const meeting: MeetingData = {
    meetId: data.meetId,
    title: data.title,
    meetUrl: data.meetUrl,
    startedAt: new Date().toISOString(),
    participants: [],
    entries: [],
  };

  await saveCurrentMeeting(meeting);
  await saveState({
    isRecording: true,
    currentMeeting: meeting,
    lastSyncStatus: "idle",
    entriesCount: 0,
  });

  // Ativar keepalive alarm (a cada 25s para evitar que o SW durma)
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });

  console.log("[Mina Meet SW] Reuniao iniciada:", data.title);
  updateBadge("REC", "#ef4444");
}

async function handleMeetingEnded(): Promise<void> {
  chrome.alarms.clear(KEEPALIVE_ALARM);

  const meeting = await getCurrentMeeting();
  if (!meeting) {
    console.log("[Mina Meet SW] Reuniao encerrada mas sem dados");
    await resetState();
    return;
  }

  meeting.endedAt = new Date().toISOString();
  meeting.durationSeconds = Math.floor(
    (new Date(meeting.endedAt).getTime() - new Date(meeting.startedAt).getTime()) / 1000
  );

  console.log(
    `[Mina Meet SW] Reuniao encerrada: ${meeting.entries.length} falas, ${meeting.durationSeconds}s`
  );

  // Enviar para o backend
  if (meeting.entries.length > 0) {
    await sendToBackend(meeting);
  } else {
    console.log("[Mina Meet SW] Nenhuma fala capturada — nao enviar");
  }

  await resetState();
}

async function handleCaptionCaptured(entry: CaptionEntry): Promise<void> {
  const meeting = await getCurrentMeeting();
  if (!meeting) return;

  meeting.entries.push(entry);
  await saveCurrentMeeting(meeting);

  const state = await getState();
  await saveState({ ...state, entriesCount: meeting.entries.length });
}

async function handleParticipantDetected(data: { name: string }): Promise<void> {
  const meeting = await getCurrentMeeting();
  if (!meeting) return;

  if (!meeting.participants.includes(data.name)) {
    meeting.participants.push(data.name);
    await saveCurrentMeeting(meeting);
  }
}

async function handleSendNow(): Promise<{ success: boolean; error?: string }> {
  const meeting = await getCurrentMeeting();
  if (!meeting || meeting.entries.length === 0) {
    return { success: false, error: "Nenhuma fala capturada" };
  }

  // Criar copia parcial para envio (reuniao ainda pode estar em andamento)
  const partialMeeting = { ...meeting, endedAt: new Date().toISOString() };
  partialMeeting.durationSeconds = Math.floor(
    (new Date(partialMeeting.endedAt).getTime() - new Date(partialMeeting.startedAt).getTime()) /
      1000
  );

  return sendToBackend(partialMeeting);
}

// ========== Envio ao Backend ==========

async function sendToBackend(
  meeting: MeetingData
): Promise<{ success: boolean; error?: string }> {
  await saveState({ lastSyncStatus: "sending" });
  updateBadge("...", "#f59e0b");

  try {
    const result = await saveTranscription(meeting);

    if (result.success) {
      await saveState({ lastSyncStatus: "success" });
      updateBadge("OK", "#22c55e");

      // Solicitar sumarizacao em background (fire-and-forget)
      if (result.transcription_id) {
        requestSummarize(result.transcription_id).catch((err) => {
          console.error("[Mina Meet SW] Erro ao sumarizar:", err);
        });
      }

      // Notificacao de sucesso
      chrome.notifications?.create({
        type: "basic",
        iconUrl: "assets/icon128.png",
        title: "Mina Meet Transcriber",
        message: `Transcricao de "${meeting.title}" salva com sucesso! (${meeting.entries.length} falas)`,
      });

      // Limpar badge apos 5s
      setTimeout(() => updateBadge("", ""), 5000);

      return { success: true };
    } else {
      await saveState({ lastSyncStatus: "error", lastError: result.error });
      updateBadge("ERR", "#ef4444");
      return { success: false, error: result.error };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await saveState({ lastSyncStatus: "error", lastError: errorMsg });
    updateBadge("ERR", "#ef4444");
    return { success: false, error: errorMsg };
  }
}

// ========== Utilidades ==========

async function resetState(): Promise<void> {
  await saveCurrentMeeting(null);
  await saveState({
    isRecording: false,
    currentMeeting: null,
    lastSyncStatus: "idle",
    entriesCount: 0,
  });
  updateBadge("", "");
}

function updateBadge(text: string, color: string): void {
  chrome.action.setBadgeText({ text });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

// Keepalive handler — evita que o SW durma durante reunioes
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Apenas manter vivo — verificar se ainda ha reuniao ativa
    getCurrentMeeting().then((meeting) => {
      if (!meeting) {
        chrome.alarms.clear(KEEPALIVE_ALARM);
      }
    });
  }
});

// Ao instalar/atualizar, limpar estado residual
chrome.runtime.onInstalled.addListener(async () => {
  await resetState();
  console.log("[Mina Meet SW] Extensao instalada/atualizada");
});
