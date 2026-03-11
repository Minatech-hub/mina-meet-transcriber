/**
 * Audio Hook — roda no MAIN WORLD (contexto da pagina).
 *
 * Responsabilidades:
 * 1. Interceptar getUserMedia e criar pipeline de mixagem (mic + Joyce)
 * 2. Injetar audio da Joyce no stream do Meet (todos ouvem)
 *
 * Comunicacao com o content script (ISOLATED world) via window.postMessage.
 */

(function () {
  "use strict";

  if ((window as any).__minaAudioHookInstalled) return;
  (window as any).__minaAudioHookInstalled = true;

  let audioContext: AudioContext | null = null;
  let mixedDestination: MediaStreamAudioDestinationNode | null = null;
  let micGain: GainNode | null = null;
  let joyceGain: GainNode | null = null;

  // ========== getUserMedia Interception ==========

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices
  );

  navigator.mediaDevices.getUserMedia = async function (
    constraints?: MediaStreamConstraints
  ): Promise<MediaStream> {
    const stream = await originalGetUserMedia(constraints);

    if (constraints?.audio && stream.getAudioTracks().length > 0) {
      console.log("[Mina Audio Hook] Interceptando stream de audio do Meet");

      try {
        if (!audioContext || audioContext.state === "closed") {
          audioContext = new AudioContext({ sampleRate: 48000 });
        }
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }

        mixedDestination = audioContext.createMediaStreamDestination();

        const micSource = audioContext.createMediaStreamSource(stream);
        micGain = audioContext.createGain();
        micGain.gain.value = 1.0;
        micSource.connect(micGain);
        micGain.connect(mixedDestination);

        joyceGain = audioContext.createGain();
        joyceGain.gain.value = 1.0;
        joyceGain.connect(mixedDestination);

        console.log("[Mina Audio Hook] Pipeline de mixagem criado com sucesso");

        const mixedStream = new MediaStream();
        mixedDestination.stream.getAudioTracks().forEach((t) => mixedStream.addTrack(t));
        stream.getVideoTracks().forEach((t) => mixedStream.addTrack(t));

        // Notificar content script que pipeline esta pronto
        window.postMessage({ type: "MINA_AUDIO_READY_RESPONSE", ready: true }, "*");

        return mixedStream;
      } catch (err) {
        console.error("[Mina Audio Hook] Erro ao criar pipeline:", err);
        return stream;
      }
    }

    return stream;
  };

  // ========== Mensagens do Content Script ==========

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const msg = event.data;

    if (msg?.type === "MINA_INJECT_AUDIO" && msg.audioBase64) {
      await injectAudio(msg.audioBase64);
    }

    if (msg?.type === "MINA_AUDIO_READY_CHECK") {
      const ready = !!(audioContext && mixedDestination && joyceGain && audioContext.state !== "closed");
      window.postMessage({ type: "MINA_AUDIO_READY_RESPONSE", ready }, "*");
    }
  });

  // ========== Injecao de Audio ==========

  async function injectAudio(base64DataUrl: string): Promise<void> {
    if (!audioContext || !joyceGain || !micGain) {
      console.error("[Mina Audio Hook] Pipeline nao inicializado");
      window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: false, error: "Pipeline nao pronto" }, "*");
      return;
    }

    try {
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const base64 = base64DataUrl.replace(/^data:audio\/[^;]+;base64,/, "");
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const audioBuffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));

      // Ducking: baixar mic enquanto Joyce fala
      micGain.gain.setValueAtTime(micGain.gain.value, audioContext.currentTime);
      micGain.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.2);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(joyceGain);

      source.onended = () => {
        if (micGain && audioContext) {
          micGain.gain.setValueAtTime(micGain.gain.value, audioContext.currentTime);
          micGain.gain.linearRampToValueAtTime(1.0, audioContext.currentTime + 0.3);
        }
        console.log("[Mina Audio Hook] Joyce terminou de falar");
        window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: true, done: true }, "*");
      };

      source.start();
      console.log(`[Mina Audio Hook] Joyce falando (${audioBuffer.duration.toFixed(1)}s)`);
      window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: true, playing: true }, "*");
    } catch (err) {
      console.error("[Mina Audio Hook] Erro ao injetar audio:", err);
      if (micGain && audioContext) {
        micGain.gain.setValueAtTime(1.0, audioContext.currentTime);
      }
      window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: false, error: String(err) }, "*");
    }
  }

  console.log("[Mina Audio Hook] Instalado — pronto para mixar audio da Joyce");
})();
