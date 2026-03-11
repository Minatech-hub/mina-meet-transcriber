/**
 * Audio Hook — roda no MAIN WORLD (contexto da pagina).
 *
 * Este script intercepta navigator.mediaDevices.getUserMedia ANTES
 * do Google Meet chama-lo. Cria um pipeline Web Audio API que mixa
 * o microfone real com audio da Joyce, para que todos na reuniao oucam.
 *
 * Comunicacao com o content script (ISOLATED world) via window.postMessage.
 * O content script envia: { type: "MINA_INJECT_AUDIO", audioBase64: "..." }
 * Este script injeta o audio no pipeline.
 */

(function () {
  "use strict";

  // Evitar dupla-injecao
  if ((window as any).__minaAudioHookInstalled) return;
  (window as any).__minaAudioHookInstalled = true;

  let audioContext: AudioContext | null = null;
  let mixedDestination: MediaStreamAudioDestinationNode | null = null;
  let micGain: GainNode | null = null;
  let joyceGain: GainNode | null = null;

  // Guardar referencia original
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices
  );

  // Substituir getUserMedia
  navigator.mediaDevices.getUserMedia = async function (
    constraints?: MediaStreamConstraints
  ): Promise<MediaStream> {
    const stream = await originalGetUserMedia(constraints);

    // Interceptar APENAS requests com audio
    if (
      constraints?.audio &&
      stream.getAudioTracks().length > 0
    ) {
      console.log("[Mina Audio Hook] Interceptando stream de audio do Meet");

      try {
        // Criar AudioContext
        if (!audioContext || audioContext.state === "closed") {
          audioContext = new AudioContext({ sampleRate: 48000 });
        }
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }

        // Pipeline: Mic → micGain → destination
        //           Joyce audio → joyceGain → destination
        mixedDestination = audioContext.createMediaStreamDestination();

        const micSource = audioContext.createMediaStreamSource(stream);
        micGain = audioContext.createGain();
        micGain.gain.value = 1.0;
        micSource.connect(micGain);
        micGain.connect(mixedDestination);

        joyceGain = audioContext.createGain();
        joyceGain.gain.value = 1.0;
        joyceGain.connect(mixedDestination);

        console.log("[Mina Audio Hook] Pipeline de mixagem criado");

        // Montar stream final: audio mixado + video original
        const mixedStream = new MediaStream();
        mixedDestination.stream.getAudioTracks().forEach((t) => mixedStream.addTrack(t));
        stream.getVideoTracks().forEach((t) => mixedStream.addTrack(t));

        return mixedStream;
      } catch (err) {
        console.error("[Mina Audio Hook] Erro ao criar pipeline:", err);
        return stream; // fallback: stream original
      }
    }

    return stream;
  };

  // Escutar mensagens do content script (ISOLATED world) via postMessage
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;

    const msg = event.data;

    // Injetar audio da Joyce
    if (msg?.type === "MINA_INJECT_AUDIO" && msg.audioBase64) {
      await injectAudio(msg.audioBase64);
    }

    // Verificar se pipeline esta pronto
    if (msg?.type === "MINA_AUDIO_READY_CHECK") {
      const ready = !!(audioContext && mixedDestination && joyceGain && audioContext.state !== "closed");
      window.postMessage({ type: "MINA_AUDIO_READY_RESPONSE", ready }, "*");
    }
  });

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

      // Decodificar base64 → ArrayBuffer
      const base64 = base64DataUrl.replace(/^data:audio\/[^;]+;base64,/, "");
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const audioBuffer = await audioContext.decodeAudioData(bytes.buffer.slice(0));

      // Ducking: baixar volume do microfone enquanto Joyce fala
      micGain.gain.setValueAtTime(micGain.gain.value, audioContext.currentTime);
      micGain.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.2);

      // Criar source e tocar
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(joyceGain);

      source.onended = () => {
        // Restaurar volume do mic gradualmente
        if (micGain && audioContext) {
          micGain.gain.setValueAtTime(micGain.gain.value, audioContext.currentTime);
          micGain.gain.linearRampToValueAtTime(1.0, audioContext.currentTime + 0.3);
        }
        console.log("[Mina Audio Hook] Joyce terminou de falar");
        window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: true, done: true }, "*");
      };

      source.start();
      console.log(
        `[Mina Audio Hook] Joyce falando na reuniao (${audioBuffer.duration.toFixed(1)}s)`
      );
      window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: true, playing: true }, "*");
    } catch (err) {
      console.error("[Mina Audio Hook] Erro ao injetar audio:", err);
      // Restaurar mic
      if (micGain && audioContext) {
        micGain.gain.setValueAtTime(1.0, audioContext.currentTime);
      }
      window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: false, error: String(err) }, "*");
    }
  }

  console.log("[Mina Audio Hook] getUserMedia interceptado — pronto para mixar audio");
})();
