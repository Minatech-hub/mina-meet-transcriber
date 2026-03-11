/**
 * Audio Hook — roda no MAIN WORLD (contexto da pagina).
 *
 * Responsabilidades:
 * 1. Interceptar getUserMedia e criar pipeline de mixagem (mic + Joyce)
 * 2. Reconhecimento de fala via Web Speech API (SpeechRecognition)
 *    — roda AQUI no MAIN world porque tem acesso direto ao microfone
 * 3. Injetar audio da Joyce no stream do Meet
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

  // ========== Speech Recognition (MAIN world) ==========

  let recognition: any = null;
  let speechRunning = false;
  let restartCount = 0;

  function startSpeechRecognition(): void {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("[Mina Audio Hook] SpeechRecognition nao suportado");
      window.postMessage({ type: "MINA_SPEECH_STATUS", supported: false }, "*");
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false; // so resultados finais para evitar duplicatas
    recognition.lang = "pt-BR";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      speechRunning = true;
      restartCount = 0;
      console.log("[Mina Audio Hook] SpeechRecognition ativo — escutando fala");
      window.postMessage({ type: "MINA_SPEECH_STATUS", active: true }, "*");
    };

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript?.trim();
          if (text && text.length >= 2) {
            console.log(`[Mina Audio Hook] Fala capturada: "${text}"`);
            // Enviar para o content script (ISOLATED world)
            window.postMessage({
              type: "MINA_SPEECH_RESULT",
              text,
              confidence: result[0]?.confidence || 0,
            }, "*");
          }
        }
      }
    };

    recognition.onerror = (event: any) => {
      // "no-speech" e normal — silencio detectado, reiniciar
      if (event.error === "no-speech") {
        // Silencioso — nao logar para nao poluir console
        return;
      }
      if (event.error === "aborted") {
        return;
      }
      if (event.error === "not-allowed") {
        console.error("[Mina Audio Hook] Microfone negado para SpeechRecognition");
        speechRunning = false;
        window.postMessage({ type: "MINA_SPEECH_STATUS", active: false, error: "not-allowed" }, "*");
        return;
      }
      console.warn("[Mina Audio Hook] SpeechRecognition erro:", event.error);
    };

    recognition.onend = () => {
      // Reiniciar automaticamente se ainda deve estar rodando
      if (speechRunning && restartCount < 100) {
        restartCount++;
        setTimeout(() => {
          if (speechRunning && recognition) {
            try {
              recognition.start();
            } catch {
              // Ja rodando
            }
          }
        }, 200);
      }
    };

    try {
      recognition.start();
    } catch (err) {
      console.error("[Mina Audio Hook] Erro ao iniciar SpeechRecognition:", err);
    }
  }

  function stopSpeechRecognition(): void {
    speechRunning = false;
    try {
      recognition?.stop();
    } catch { /* ignorar */ }
    recognition = null;
  }

  // ========== getUserMedia Interception ==========

  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices
  );

  navigator.mediaDevices.getUserMedia = async function (
    constraints?: MediaStreamConstraints
  ): Promise<MediaStream> {
    const stream = await originalGetUserMedia(constraints);

    if (
      constraints?.audio &&
      stream.getAudioTracks().length > 0
    ) {
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

        console.log("[Mina Audio Hook] Pipeline de mixagem criado");

        const mixedStream = new MediaStream();
        mixedDestination.stream.getAudioTracks().forEach((t) => mixedStream.addTrack(t));
        stream.getVideoTracks().forEach((t) => mixedStream.addTrack(t));

        // Iniciar reconhecimento de fala APOS o mic ser ativado
        // Aguardar 2s para o Meet estabilizar
        setTimeout(() => {
          if (!speechRunning) {
            console.log("[Mina Audio Hook] Iniciando reconhecimento de fala...");
            startSpeechRecognition();
          }
        }, 2000);

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

    // Injetar audio da Joyce
    if (msg?.type === "MINA_INJECT_AUDIO" && msg.audioBase64) {
      await injectAudio(msg.audioBase64);
    }

    // Verificar se pipeline esta pronto
    if (msg?.type === "MINA_AUDIO_READY_CHECK") {
      const ready = !!(audioContext && mixedDestination && joyceGain && audioContext.state !== "closed");
      window.postMessage({ type: "MINA_AUDIO_READY_RESPONSE", ready }, "*");
    }

    // Iniciar/parar reconhecimento de fala
    if (msg?.type === "MINA_START_SPEECH") {
      if (!speechRunning) startSpeechRecognition();
    }
    if (msg?.type === "MINA_STOP_SPEECH") {
      stopSpeechRecognition();
    }

    // Status do speech recognition
    if (msg?.type === "MINA_SPEECH_STATUS_CHECK") {
      window.postMessage({
        type: "MINA_SPEECH_STATUS",
        active: speechRunning,
        supported: !!(
          (window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition
        ),
      }, "*");
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

      // Ducking: baixar volume do mic enquanto Joyce fala
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
      console.log(
        `[Mina Audio Hook] Joyce falando (${audioBuffer.duration.toFixed(1)}s)`
      );
      window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: true, playing: true }, "*");
    } catch (err) {
      console.error("[Mina Audio Hook] Erro ao injetar audio:", err);
      if (micGain && audioContext) {
        micGain.gain.setValueAtTime(1.0, audioContext.currentTime);
      }
      window.postMessage({ type: "MINA_INJECT_AUDIO_RESULT", success: false, error: String(err) }, "*");
    }
  }

  console.log("[Mina Audio Hook] Instalado — getUserMedia interceptado, SpeechRecognition pronto");
})();
