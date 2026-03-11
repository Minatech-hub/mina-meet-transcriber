import { CaptionObserver } from "./caption-observer";
import { MeetingDetector } from "./meeting-detector";
import { CaptionEntry, Message } from "@/lib/types";

/**
 * Content Script principal — injeta no Google Meet.
 *
 * Responsavel por:
 * 1. Detectar inicio/fim de reunioes
 * 2. Capturar legendas (closed captions)
 * 3. Enviar dados para o Service Worker via chrome.runtime.sendMessage
 */

let captionObserver: CaptionObserver | null = null;
let meetingDetector: MeetingDetector | null = null;
let meetingStartTime = 0;
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
}

function onMeetingStarted(title: string): void {
  meetingStartTime = Date.now();

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

  // Tentar ativar legendas automaticamente (verificar config primeiro)
  chrome.storage.local.get("mina_config", (result) => {
    const config = result.mina_config;
    if (config?.autoEnableCaptions) {
      // Pequeno delay para garantir que o UI do Meet ja carregou
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

  if (participantPollInterval) {
    clearInterval(participantPollInterval);
    participantPollInterval = null;
  }

  sendMessage({ type: "MEETING_ENDED" });

  removeRecordingIndicator();
}

/** Injeta um pequeno indicador visual mostrando que esta gravando */
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
      <span>Mina Transcriber</span>
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

  // Verificar se estamos em uma pagina de reuniao (nao no lobby/home)
  if (!window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) {
    console.log("[Mina Meet] Nao e uma pagina de reuniao — aguardando...");
    // Observar mudancas de URL (SPA)
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
      // Forcar inicio manual
      const title = meetingDetector.extractMeetingTitle();
      onMeetingStarted(title);
    } else if (!msg.data.enabled && captionObserver) {
      onMeetingEnded();
    }
    sendResponse({ ok: true });
  }
  return false;
});

init();
