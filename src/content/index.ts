import { CaptionObserver } from "./caption-observer";
import { MeetingDetector } from "./meeting-detector";
import { JoyceAssistant } from "./joyce-assistant";
import { installAudioInjector } from "./audio-injector";
import { CaptionEntry, JoyceCommand, JoyceResponse, Message } from "@/lib/types";
import { playJoyceResponse } from "@/lib/voice";

// CRITICO: instalar o interceptador de audio IMEDIATAMENTE,
// antes do Google Meet chamar getUserMedia para o microfone.
// Se instalar tarde demais, o Meet ja tera o stream original e Joyce nao sera ouvida.
installAudioInjector();

/**
 * Content Script principal — injeta no Google Meet.
 *
 * Responsavel por:
 * 1. Detectar inicio/fim de reunioes
 * 2. Capturar legendas (closed captions)
 * 3. Enviar dados para o Service Worker via chrome.runtime.sendMessage
 * 4. Detectar comandos para a Joyce e reproduzir respostas por audio
 */

let captionObserver: CaptionObserver | null = null;
let meetingDetector: MeetingDetector | null = null;
let joyceAssistant: JoyceAssistant | null = null;
let meetingStartTime = 0;
let currentMeetingTitle = "";
let participantPollInterval: ReturnType<typeof setInterval> | null = null;

function sendMessage(msg: Message): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Service worker pode estar inativo — sera reativado pela proxima mensagem
  });
}

function onCaptionCaptured(entry: CaptionEntry): void {
  sendMessage({ type: "CAPTION_CAPTURED", data: entry });

  // Tambem detectar participante pelo speaker
  if (entry.speaker) {
    sendMessage({ type: "PARTICIPANT_DETECTED", data: { name: entry.speaker } });
  }

  // Alimentar a Joyce com cada fala para deteccao de comandos
  joyceAssistant?.feed(entry);
}

/** Quando a Joyce detecta um comando nas legendas */
async function onJoyceCommand(command: JoyceCommand): Promise<void> {
  console.log(`[Mina Meet Joyce] Comando detectado de ${command.speaker}: "${command.command}"`);

  // Mostrar indicador de processamento
  showJoyceThinkingIndicator();

  // Enviar comando para o Service Worker → backend
  sendMessage({ type: "JOYCE_COMMAND", data: command });

  // O Service Worker vai processar e retornar a resposta via JOYCE_RESPONSE
}

/** Quando a Joyce responde (recebido do Service Worker) */
async function onJoyceResponse(response: JoyceResponse): Promise<void> {
  hideJoyceThinkingIndicator();

  if (!response.success && !response.textResponse) {
    console.error("[Mina Meet Joyce] Resposta de erro:", response.error);
    return;
  }

  // Mostrar resposta em texto na tela
  showJoyceTextBubble(response.textResponse);

  // Reproduzir resposta por audio
  try {
    await playJoyceResponse(response.textResponse, response.audioUrl || undefined);
  } catch (err) {
    console.error("[Mina Meet Joyce] Erro ao reproduzir audio:", err);
  }

  // Notificar acao executada
  if (response.action) {
    const action = response.action;
    if (action.type === "task_created") {
      console.log("[Mina Meet Joyce] Tarefa criada:", action.details);
    }
  }
}

function onMeetingStarted(title: string): void {
  meetingStartTime = Date.now();
  currentMeetingTitle = title;

  const meetId =
    window.location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/)?.[1] ||
    window.location.pathname.replace("/", "");

  sendMessage({
    type: "MEETING_STARTED",
    data: {
      meetId,
      title,
      meetUrl: window.location.href,
    },
  });

  // Iniciar captura de legendas
  captionObserver = new CaptionObserver(onCaptionCaptured, meetingStartTime);
  captionObserver.start();

  // Iniciar assistente Joyce
  joyceAssistant = new JoyceAssistant(onJoyceCommand);
  console.log("[Mina Meet] Joyce assistente ativada");

  // Tentar ativar legendas automaticamente (verificar config primeiro)
  chrome.storage.local.get("mina_config", (result) => {
    const config = result.mina_config;
    if (config?.autoEnableCaptions) {
      setTimeout(() => {
        captionObserver?.tryEnableCaptions();
      }, 3000);
    }
  });

  // Poll participantes a cada 10s
  participantPollInterval = setInterval(() => {
    if (meetingDetector) {
      const participants = meetingDetector.extractParticipants();
      participants.forEach((name) => {
        sendMessage({ type: "PARTICIPANT_DETECTED", data: { name } });
      });
    }
  }, 10000);

  // Injetar indicador visual
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

// ========== Indicadores Visuais da Joyce ==========

function showJoyceThinkingIndicator(): void {
  if (document.getElementById("mina-joyce-thinking")) return;

  const el = document.createElement("div");
  el.id = "mina-joyce-thinking";
  el.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      background: rgba(0, 0, 0, 0.8);
      border: 1px solid rgba(0, 212, 170, 0.4);
      border-radius: 24px;
      backdrop-filter: blur(12px);
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
      font-size: 13px;
      color: #00d4aa;
      animation: mina-fade-in 0.3s ease;
    ">
      <div style="width:14px;height:14px;border:2px solid #00d4aa;border-top-color:transparent;border-radius:50%;animation:mina-spin 0.8s linear infinite;"></div>
      <span>Joyce pensando...</span>
    </div>
    <style>
      @keyframes mina-spin { to { transform: rotate(360deg); } }
    </style>
  `;
  document.body.appendChild(el);
}

function hideJoyceThinkingIndicator(): void {
  document.getElementById("mina-joyce-thinking")?.remove();
}

function showJoyceTextBubble(text: string): void {
  // Remover bubble anterior
  document.getElementById("mina-joyce-bubble")?.remove();

  const el = document.createElement("div");
  el.id = "mina-joyce-bubble";
  el.innerHTML = `
    <div style="
      position: fixed;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      max-width: 400px;
      padding: 14px 18px;
      background: linear-gradient(135deg, rgba(26,26,46,0.95), rgba(15,15,15,0.95));
      border: 1px solid rgba(0, 212, 170, 0.3);
      border-radius: 16px;
      backdrop-filter: blur(12px);
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #e0e0e0;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 20px rgba(0,212,170,0.1);
      animation: mina-bubble-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    ">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <div style="width:6px;height:6px;background:#00d4aa;border-radius:50;box-shadow:0 0 6px #00d4aa;"></div>
        <span style="font-weight:600;font-size:11px;color:#00d4aa;text-transform:uppercase;letter-spacing:0.5px;">Joyce</span>
      </div>
      <div>${text}</div>
    </div>
    <style>
      @keyframes mina-bubble-in {
        from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.9); }
        to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }
    </style>
  `;
  document.body.appendChild(el);

  // Auto-remover apos 10s
  setTimeout(() => {
    const bubble = document.getElementById("mina-joyce-bubble");
    if (bubble) {
      bubble.style.opacity = "0";
      bubble.style.transition = "opacity 0.5s ease";
      setTimeout(() => bubble.remove(), 500);
    }
  }, 10000);
}

// ========== Indicador de gravacao ==========

function injectRecordingIndicator(): void {
  if (document.getElementById("mina-meet-indicator")) return;

  const indicator = document.createElement("div");
  indicator.id = "mina-meet-indicator";
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: rgba(0, 0, 0, 0.75);
      border-radius: 20px;
      backdrop-filter: blur(8px);
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
      font-size: 12px;
      color: #fff;
      pointer-events: none;
      animation: mina-fade-in 0.3s ease;
    ">
      <div style="
        width: 8px;
        height: 8px;
        background: #ef4444;
        border-radius: 50%;
        animation: mina-pulse 1.5s ease-in-out infinite;
      "></div>
      <span>Mina Transcriber + Joyce</span>
    </div>
    <style>
      @keyframes mina-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      @keyframes mina-fade-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    </style>
  `;

  document.body.appendChild(indicator);
}

function removeRecordingIndicator(): void {
  document.getElementById("mina-meet-indicator")?.remove();
}

// ========== Inicializacao ==========

function init(): void {
  console.log("[Mina Meet] Content script carregado em:", window.location.href);

  if (!window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) {
    console.log("[Mina Meet] Nao e uma pagina de reuniao — aguardando...");
    let lastUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        if (window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) {
          startDetection();
          urlObserver.disconnect();
        }
      }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });
    return;
  }

  startDetection();
}

function startDetection(): void {
  meetingDetector = new MeetingDetector(onMeetingStarted, onMeetingEnded);
  meetingDetector.start();
  console.log("[Mina Meet] Detector de reuniao iniciado");
}

// Escutar mensagens do popup/service worker
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === "TOGGLE_RECORDING") {
    if (msg.data.enabled && !captionObserver && meetingDetector) {
      const title = meetingDetector.extractMeetingTitle();
      onMeetingStarted(title);
    } else if (!msg.data.enabled && captionObserver) {
      onMeetingEnded();
    }
    sendResponse({ ok: true });
  }

  // Receber resposta da Joyce do Service Worker
  if (msg.type === "JOYCE_RESPONSE") {
    onJoyceResponse(msg.data);
    sendResponse({ ok: true });
  }

  return false;
});

init();
