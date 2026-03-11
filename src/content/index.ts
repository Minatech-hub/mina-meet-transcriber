import { CaptionObserver } from "./caption-observer";
import { MeetingDetector } from "./meeting-detector";
import { JoyceAssistant } from "./joyce-assistant";
import { installAudioInjector } from "./audio-injector";
import { CaptionEntry, JoyceCommand, JoyceResponse, Message } from "@/lib/types";
import { playJoyceResponse } from "@/lib/voice";

// CRITICO: instalar o interceptador de audio IMEDIATAMENTE,
// antes do Google Meet chamar getUserMedia para o microfone.
installAudioInjector();

/**
 * Content Script principal — injeta no Google Meet.
 *
 * Captura fala por DOIS metodos simultaneos:
 * 1. Web Speech API (SpeechRecognition) — captura microfone local com alta confiabilidade
 * 2. CaptionObserver — tenta capturar legendas do Meet (outros participantes)
 *
 * Joyce responde SEMPRE por voz (audio ElevenLabs ou Web Speech fallback).
 */

let captionObserver: CaptionObserver | null = null;
let speechActive = false;
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

// ========== Receber fala do MAIN world (audio-hook.ts SpeechRecognition) ==========

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;

  // Resultado de fala capturada pelo SpeechRecognition no MAIN world
  if (msg?.type === "MINA_SPEECH_RESULT" && msg.text) {
    const text = msg.text as string;
    console.log(`[Mina Meet] Fala recebida do MAIN world: "${text}"`);

    const entry: CaptionEntry = {
      timestamp: Date.now() - meetingStartTime,
      speaker: "Eu",
      text,
      capturedAt: new Date().toISOString(),
    };

    onCaptionCaptured(entry);
  }

  // Status do SpeechRecognition
  if (msg?.type === "MINA_SPEECH_STATUS") {
    if (msg.active) {
      console.log("[Mina Meet] SpeechRecognition ativo no MAIN world");
    } else if (msg.error) {
      console.warn("[Mina Meet] SpeechRecognition erro:", msg.error);
    }
  }
});

function onCaptionCaptured(entry: CaptionEntry): void {
  sendMessage({ type: "CAPTION_CAPTURED", data: entry });

  // Tambem detectar participante pelo speaker
  if (entry.speaker) {
    sendMessage({ type: "PARTICIPANT_DETECTED", data: { name: entry.speaker } });
  }

  // Alimentar a Joyce com cada fala para deteccao de comandos
  joyceAssistant?.feed(entry);
}

/** Quando a Joyce detecta um comando nas legendas/fala */
async function onJoyceCommand(command: JoyceCommand): Promise<void> {
  console.log(`[Mina Meet Joyce] Comando detectado de ${command.speaker}: "${command.command}"`);

  // Mostrar indicador de processamento
  showJoyceThinkingIndicator();

  // Enviar comando para o Service Worker → backend
  sendMessage({ type: "JOYCE_COMMAND", data: command });
}

/** Quando a Joyce responde (recebido do Service Worker) */
async function onJoyceResponse(response: JoyceResponse): Promise<void> {
  hideJoyceThinkingIndicator();

  if (!response.success && !response.textResponse) {
    console.error("[Mina Meet Joyce] Resposta de erro:", response.error);
    return;
  }

  console.log("[Mina Meet Joyce] Resposta recebida, reproduzindo audio...");
  console.log("[Mina Meet Joyce] Texto:", response.textResponse);
  console.log("[Mina Meet Joyce] Tem audioUrl:", !!response.audioUrl);

  // Mostrar bubble visual (texto pequeno na tela)
  showJoyceTextBubble(response.textResponse);

  // REPRODUZIR POR VOZ — prioridade absoluta
  try {
    await playJoyceResponse(response.textResponse, response.audioUrl || undefined);
    console.log("[Mina Meet Joyce] Audio reproduzido com sucesso");
  } catch (err) {
    console.error("[Mina Meet Joyce] Erro ao reproduzir audio, tentando fallback:", err);
    // Fallback direto: tentar Web Speech API
    try {
      await speakFallback(response.textResponse);
    } catch (err2) {
      console.error("[Mina Meet Joyce] Fallback tambem falhou:", err2);
    }
  }

  // Notificar acao executada
  if (response.action) {
    console.log("[Mina Meet Joyce] Acao:", response.action.type, response.action.details);
  }
}

/** Fallback de voz direto no content script */
function speakFallback(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("speechSynthesis nao disponivel"));
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 1.05;
    utterance.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find((v) => v.lang.startsWith("pt"));
    if (ptVoice) utterance.voice = ptVoice;
    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(e);
    window.speechSynthesis.speak(utterance);
  });
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

  // Iniciar assistente Joyce
  joyceAssistant = new JoyceAssistant(onJoyceCommand);
  console.log("[Mina Meet] Joyce assistente ativada — esperando comandos de voz");

  // === METODO 1: Web Speech API no MAIN world (via audio-hook.ts) ===
  // O audio-hook.ts inicia automaticamente apos interceptar getUserMedia
  // Mas podemos pedir para iniciar manualmente tambem
  window.postMessage({ type: "MINA_START_SPEECH" }, "*");
  speechActive = true;
  console.log("[Mina Meet] Solicitando SpeechRecognition no MAIN world");

  // === METODO 2: CaptionObserver (legendas do Meet — captura outros participantes) ===
  captionObserver = new CaptionObserver(onCaptionCaptured, meetingStartTime);
  captionObserver.start();

  // Ativar legendas do Meet automaticamente
  setTimeout(() => {
    console.log("[Mina Meet] Ativando legendas do Meet...");
    captionObserver?.tryEnableCaptions();
  }, 3000);

  setTimeout(() => {
    captionObserver?.tryEnableCaptions();
  }, 8000);

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

  // Parar SpeechRecognition no MAIN world
  window.postMessage({ type: "MINA_STOP_SPEECH" }, "*");
  speechActive = false;

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
        <div style="width:6px;height:6px;background:#00d4aa;border-radius:50%;box-shadow:0 0 6px #00d4aa;"></div>
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

  // Auto-remover apos 15s
  setTimeout(() => {
    const bubble = document.getElementById("mina-joyce-bubble");
    if (bubble) {
      bubble.style.opacity = "0";
      bubble.style.transition = "opacity 0.5s ease";
      setTimeout(() => bubble.remove(), 500);
    }
  }, 15000);
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

  // Forcar ativacao de legendas
  if (msg.type === "FORCE_ENABLE_CAPTIONS") {
    console.log("[Mina Meet] Forcando ativacao de legendas via popup...");
    captionObserver?.tryEnableCaptions();
    sendResponse({ ok: true });
  }

  // Diagnostico detalhado do content script
  if (msg.type === "GET_CONTENT_DIAGNOSTICS") {
    const diag = {
      url: window.location.href,
      meetingDetectorActive: !!meetingDetector,
      captionObserverActive: !!captionObserver,
      speechCaptureActive: speechActive,
      joyceAssistantActive: !!joyceAssistant,
      meetingStartTime: meetingStartTime > 0 ? new Date(meetingStartTime).toISOString() : null,
      currentTitle: currentMeetingTitle,
      speechApiSupported: true, // roda no MAIN world via audio-hook
      ariaLiveCount: document.querySelectorAll('[aria-live]').length,
      videoCount: document.querySelectorAll('video').length,
      buttonsWithAria: document.querySelectorAll('button[aria-label]').length,
    };
    sendResponse(diag);
  }

  return false;
});

init();
