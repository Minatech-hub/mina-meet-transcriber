import { CaptionObserver } from "./caption-observer";
import { MeetingDetector } from "./meeting-detector";
import { JoyceAssistant } from "./joyce-assistant";
import { installAudioInjector } from "./audio-injector";
import { CaptionEntry, JoyceCommand, JoyceResponse, Message } from "@/lib/types";
import { playJoyceResponse } from "@/lib/voice";

// Instalar interceptador de audio antes do Meet chamar getUserMedia
installAudioInjector();

/**
 * Content Script — injeta no Google Meet.
 *
 * Captura legendas do DOM do Meet (mesmo metodo do Tactiq.io).
 * Legendas DEVEM estar ativadas (CC) para funcionar.
 * Joyce responde por voz (ElevenLabs TTS + pipeline de audio).
 */

let captionObserver: CaptionObserver | null = null;
let meetingDetector: MeetingDetector | null = null;
let joyceAssistant: JoyceAssistant | null = null;
let meetingStartTime = 0;
let currentMeetingTitle = "";
let participantPollInterval: ReturnType<typeof setInterval> | null = null;

function sendMessage(msg: Message): void {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function onCaptionCaptured(entry: CaptionEntry): void {
  sendMessage({ type: "CAPTION_CAPTURED", data: entry });

  if (entry.speaker) {
    sendMessage({ type: "PARTICIPANT_DETECTED", data: { name: entry.speaker } });
  }

  // Alimentar Joyce para deteccao de comandos
  joyceAssistant?.feed(entry);
}

/** Quando a Joyce detecta um comando na fala */
async function onJoyceCommand(command: JoyceCommand): Promise<void> {
  console.log(`[Mina Joyce] Comando: ${command.speaker} → "${command.command}"`);
  showJoyceThinkingIndicator();
  sendMessage({ type: "JOYCE_COMMAND", data: command });
}

/** Quando a Joyce responde (via Service Worker) */
async function onJoyceResponse(response: JoyceResponse): Promise<void> {
  hideJoyceThinkingIndicator();

  if (!response.success && !response.textResponse) {
    console.error("[Mina Joyce] Erro:", response.error);
    return;
  }

  console.log("[Mina Joyce] Resposta:", response.textResponse);
  console.log("[Mina Joyce] audioUrl:", !!response.audioUrl);

  // Mostrar texto na tela
  showJoyceTextBubble(response.textResponse);

  // REPRODUZIR POR VOZ (voice.ts cuida de todos os fallbacks internamente)
  await playJoyceResponse(response.textResponse, response.audioUrl || undefined);
  console.log("[Mina Joyce] playJoyceResponse concluido");
}

function onMeetingStarted(title: string): void {
  meetingStartTime = Date.now();
  currentMeetingTitle = title;

  const meetId =
    window.location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)?.[1] ||
    window.location.pathname.replace("/", "");

  sendMessage({
    type: "MEETING_STARTED",
    data: { meetId, title, meetUrl: window.location.href },
  });

  // Iniciar Joyce
  joyceAssistant = new JoyceAssistant(onJoyceCommand);
  console.log("[Mina Meet] Joyce ativada");

  // Iniciar captura de legendas do DOM (metodo Tactiq)
  captionObserver = new CaptionObserver(onCaptionCaptured, meetingStartTime);
  captionObserver.start();

  // Tentar ativar legendas automaticamente
  setTimeout(() => captionObserver?.tryEnableCaptions(), 3000);
  setTimeout(() => captionObserver?.tryEnableCaptions(), 8000);
  setTimeout(() => captionObserver?.tryEnableCaptions(), 15000);

  // Poll participantes
  participantPollInterval = setInterval(() => {
    if (meetingDetector) {
      meetingDetector.extractParticipants().forEach((name) => {
        sendMessage({ type: "PARTICIPANT_DETECTED", data: { name } });
      });
    }
  }, 10000);

  injectRecordingIndicator();
}

function onMeetingEnded(): void {
  captionObserver?.stop();
  captionObserver = null;
  joyceAssistant?.reset();
  joyceAssistant = null;

  if (participantPollInterval) {
    clearInterval(participantPollInterval);
    participantPollInterval = null;
  }

  sendMessage({ type: "MEETING_ENDED" });
  removeRecordingIndicator();
}

// ========== Indicadores Visuais ==========

function showJoyceThinkingIndicator(): void {
  if (document.getElementById("mina-joyce-thinking")) return;
  const el = document.createElement("div");
  el.id = "mina-joyce-thinking";
  el.innerHTML = `
    <div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:8px;padding:10px 18px;background:rgba(0,0,0,0.85);border:1px solid rgba(0,212,170,0.4);border-radius:24px;backdrop-filter:blur(12px);font-family:'Google Sans',Roboto,sans-serif;font-size:13px;color:#00d4aa;">
      <div style="width:14px;height:14px;border:2px solid #00d4aa;border-top-color:transparent;border-radius:50%;animation:mina-spin 0.8s linear infinite;"></div>
      Joyce pensando...
    </div>
    <style>@keyframes mina-spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(el);
}

function hideJoyceThinkingIndicator(): void {
  document.getElementById("mina-joyce-thinking")?.remove();
}

function showJoyceTextBubble(text: string): void {
  document.getElementById("mina-joyce-bubble")?.remove();
  const el = document.createElement("div");
  el.id = "mina-joyce-bubble";
  el.innerHTML = `
    <div style="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:99999;max-width:400px;padding:14px 18px;background:linear-gradient(135deg,rgba(26,26,46,0.95),rgba(15,15,15,0.95));border:1px solid rgba(0,212,170,0.3);border-radius:16px;backdrop-filter:blur(12px);font-family:'Google Sans',Roboto,sans-serif;font-size:13px;line-height:1.5;color:#e0e0e0;box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:mina-bubble-in 0.4s cubic-bezier(0.34,1.56,0.64,1);">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <div style="width:6px;height:6px;background:#00d4aa;border-radius:50%;box-shadow:0 0 6px #00d4aa;"></div>
        <span style="font-weight:600;font-size:11px;color:#00d4aa;text-transform:uppercase;letter-spacing:0.5px;">Joyce</span>
      </div>
      <div>${text}</div>
    </div>
    <style>@keyframes mina-bubble-in{from{opacity:0;transform:translateX(-50%) translateY(10px) scale(0.9)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}</style>
  `;
  document.body.appendChild(el);
  setTimeout(() => {
    const b = document.getElementById("mina-joyce-bubble");
    if (b) { b.style.opacity = "0"; b.style.transition = "opacity 0.5s"; setTimeout(() => b.remove(), 500); }
  }, 15000);
}

function injectRecordingIndicator(): void {
  if (document.getElementById("mina-meet-indicator")) return;
  const el = document.createElement("div");
  el.id = "mina-meet-indicator";
  el.innerHTML = `
    <div style="position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:6px;padding:6px 14px;background:rgba(0,0,0,0.75);border-radius:20px;backdrop-filter:blur(8px);font-family:'Google Sans',Roboto,sans-serif;font-size:12px;color:#fff;pointer-events:none;">
      <div style="width:8px;height:8px;background:#ef4444;border-radius:50%;animation:mina-pulse 1.5s ease-in-out infinite;"></div>
      Mina Transcriber + Joyce
    </div>
    <style>@keyframes mina-pulse{0%,100%{opacity:1}50%{opacity:0.3}}</style>
  `;
  document.body.appendChild(el);
}

function removeRecordingIndicator(): void {
  document.getElementById("mina-meet-indicator")?.remove();
}

// ========== Inicializacao ==========

function init(): void {
  console.log("[Mina Meet] Content script carregado:", window.location.href);

  if (!window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) {
    console.log("[Mina Meet] Aguardando pagina de reuniao...");
    let lastUrl = window.location.href;
    const obs = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) {
          startDetection();
          obs.disconnect();
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return;
  }

  startDetection();
}

function startDetection(): void {
  meetingDetector = new MeetingDetector(onMeetingStarted, onMeetingEnded);
  meetingDetector.start();
  console.log("[Mina Meet] Detector de reuniao iniciado");
}

// ========== Mensagens do popup/service worker ==========

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === "TOGGLE_RECORDING") {
    if (msg.data.enabled && !captionObserver && meetingDetector) {
      onMeetingStarted(meetingDetector.extractMeetingTitle());
    } else if (!msg.data.enabled && captionObserver) {
      onMeetingEnded();
    }
    sendResponse({ ok: true });
  }

  if (msg.type === "JOYCE_RESPONSE") {
    onJoyceResponse(msg.data);
    sendResponse({ ok: true });
  }

  if (msg.type === "FORCE_ENABLE_CAPTIONS") {
    captionObserver?.tryEnableCaptions();
    sendResponse({ ok: true });
  }

  if (msg.type === "GET_CONTENT_DIAGNOSTICS") {
    sendResponse({
      url: window.location.href,
      meetingDetectorActive: !!meetingDetector,
      captionObserverActive: !!captionObserver,
      joyceAssistantActive: !!joyceAssistant,
      currentTitle: currentMeetingTitle,
      ariaLiveCount: document.querySelectorAll('[aria-live]').length,
      videoCount: document.querySelectorAll('video').length,
      buttonsWithAria: document.querySelectorAll('button[aria-label]').length,
    });
  }

  return false;
});

init();
