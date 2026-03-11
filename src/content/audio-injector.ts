/**
 * Audio Injector — ponte entre o content script (ISOLATED) e o audio-hook (MAIN).
 *
 * O audio-hook.ts roda no MAIN WORLD e intercepta o getUserMedia do Meet.
 * Este modulo roda no ISOLATED WORLD e se comunica via window.postMessage.
 *
 * IMPORTANTE: Este modulo so cuida da INJECAO no pipeline Meet (para todos ouvirem).
 * O audio LOCAL (para o usuario ouvir) e tratado em voice.ts via Audio element.
 */

let audioReady = false;

// Escutar respostas do audio-hook (MAIN world)
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;

  if (msg?.type === "MINA_AUDIO_READY_RESPONSE") {
    audioReady = msg.ready;
    console.log("[Mina Injector] Pipeline Meet:", audioReady ? "PRONTO" : "NAO PRONTO");
  }
});

/** Verifica se o pipeline de audio no MAIN world esta pronto */
function isAudioPipelineReady(): Promise<boolean> {
  return new Promise((resolve) => {
    // Primeiro check rapido via cache
    if (audioReady) {
      resolve(true);
      return;
    }

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "MINA_AUDIO_READY_RESPONSE") {
        window.removeEventListener("message", handler);
        clearTimeout(timer);
        resolve(event.data.ready);
      }
    };

    window.addEventListener("message", handler);
    window.postMessage({ type: "MINA_AUDIO_READY_CHECK" }, "*");

    // Timeout de 2s
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve(false);
    }, 2000);
  });
}

/**
 * Tenta injetar audio da Joyce no stream do Meet (todos ouvem).
 * Se pipeline nao estiver pronto, rejeita imediatamente.
 * Chamado em paralelo pelo voice.ts — nao bloqueia audio local.
 */
export async function tryInjectIntoMeetPipeline(audioBase64: string): Promise<void> {
  const ready = await isAudioPipelineReady();

  if (!ready) {
    throw new Error("Pipeline Meet nao pronto (mic nao ativo ou Meet nao interceptado)");
  }

  console.log("[Mina Injector] Enviando audio para o pipeline Meet (todos ouvem)");

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Timeout ao injetar audio no Meet (30s)"));
    }, 30000);

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "MINA_INJECT_AUDIO_RESULT") {
        if (event.data.done || !event.data.success) {
          clearTimeout(timeout);
          window.removeEventListener("message", handler);
          if (event.data.success) {
            console.log("[Mina Injector] Audio injetado no Meet com sucesso");
            resolve();
          } else {
            reject(new Error(event.data.error || "Erro ao injetar audio no Meet"));
          }
        }
        // Se playing=true, aguardar o done
      }
    };

    window.addEventListener("message", handler);
    window.postMessage({ type: "MINA_INJECT_AUDIO", audioBase64 }, "*");
  });
}

// No-op: o hook ja e carregado pelo manifest como script separado no MAIN world
export function installAudioInjector(): void {
  console.log("[Mina Injector] Audio hook carregado via manifest (MAIN world)");
}
