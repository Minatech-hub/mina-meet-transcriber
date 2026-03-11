/**
 * Audio Injector — ponte entre o content script (ISOLATED) e o audio-hook (MAIN).
 *
 * O audio-hook.ts roda no MAIN WORLD e intercepta o getUserMedia do Meet.
 * Este modulo roda no ISOLATED WORLD e se comunica via window.postMessage.
 *
 * Fluxo:
 * 1. Content script recebe audio da Joyce (base64 do backend)
 * 2. Este modulo envia via postMessage para o audio-hook
 * 3. O audio-hook decodifica e injeta no pipeline Web Audio
 * 4. O Meet transmite o audio mixado (mic + Joyce) para todos
 */

let audioReady = false;

// Escutar respostas do audio-hook (MAIN world)
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;

  if (msg?.type === "MINA_AUDIO_READY_RESPONSE") {
    audioReady = msg.ready;
  }
});

/** Verifica se o pipeline de audio no MAIN world esta pronto */
export function isAudioPipelineReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "MINA_AUDIO_READY_RESPONSE") {
        window.removeEventListener("message", handler);
        resolve(event.data.ready);
      }
    };

    window.addEventListener("message", handler);
    window.postMessage({ type: "MINA_AUDIO_READY_CHECK" }, "*");

    // Timeout de 1s
    setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve(false);
    }, 1000);
  });
}

/**
 * Injeta audio da Joyce no stream do Meet (todos ouvem).
 *
 * Se o audio do ElevenLabs estiver disponivel e o pipeline pronto,
 * injeta no stream. Caso contrario, faz fallback local.
 */
export async function injectJoyceAudio(audioBase64?: string, text?: string): Promise<void> {
  // Se temos audio do ElevenLabs, tentar injetar no Meet
  if (audioBase64) {
    const ready = await isAudioPipelineReady();

    if (ready) {
      console.log("[Mina Injector] Enviando audio para o pipeline (todos ouvem)");

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener("message", handler);
          reject(new Error("Timeout ao injetar audio"));
        }, 30000); // 30s max para audio longo

        const handler = (event: MessageEvent) => {
          if (event.data?.type === "MINA_INJECT_AUDIO_RESULT") {
            if (event.data.done || !event.data.success) {
              clearTimeout(timeout);
              window.removeEventListener("message", handler);
              if (event.data.success) {
                resolve();
              } else {
                reject(new Error(event.data.error || "Erro ao injetar audio"));
              }
            }
            // Se playing=true, aguardar o done
          }
        };

        window.addEventListener("message", handler);
        window.postMessage({ type: "MINA_INJECT_AUDIO", audioBase64 }, "*");
      });
    }

    console.log("[Mina Injector] Pipeline nao pronto, fallback para audio local");
  }

  // Fallback: Web Speech API local (apenas o usuario ouve)
  if (text) {
    console.log("[Mina Injector] Fallback: Web Speech local");
    return speakLocal(text);
  }
}

/** Web Speech API local (apenas o usuario ouve) */
function speakLocal(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("Web Speech API nao suportada"));
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 1.05;
    utterance.pitch = 1.1;
    utterance.volume = 0.85;

    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find((v) => v.lang.startsWith("pt"));
    if (ptVoice) utterance.voice = ptVoice;

    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(e);

    window.speechSynthesis.speak(utterance);
  });
}

// Nao precisa mais da funcao installAudioInjector — o audio-hook.ts
// roda direto como content script no MAIN world via manifest.json
export function installAudioInjector(): void {
  // No-op: o hook ja e carregado pelo manifest como script separado
  console.log("[Mina Injector] Audio hook carregado via manifest (MAIN world)");
}
