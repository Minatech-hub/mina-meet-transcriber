/**
 * Modulo de voz — reproduz respostas da Joyce por audio.
 *
 * Cadeia de fallback:
 * 1. Pipeline Meet (via audio-hook, todos na reuniao ouvem)
 * 2. Audio element local (new Audio, so o usuario ouve)
 * 3. Web Speech API (speechSynthesis, so o usuario ouve)
 *
 * Cada passo tem logging para debug.
 */

import { injectJoyceAudio } from "@/content/audio-injector";

export async function playJoyceResponse(text: string, audioBase64?: string): Promise<void> {
  showSpeakingIndicator();

  try {
    // === METODO 1: Pipeline do Meet (todos ouvem) ===
    if (audioBase64) {
      try {
        await injectJoyceAudio(audioBase64, text);
        console.log("[Mina Voice] Audio reproduzido via pipeline Meet");
        return;
      } catch (err) {
        console.warn("[Mina Voice] Pipeline falhou:", err);
      }

      // === METODO 2: Audio element local ===
      try {
        await playAudioElement(audioBase64);
        console.log("[Mina Voice] Audio reproduzido via Audio element");
        return;
      } catch (err) {
        console.warn("[Mina Voice] Audio element falhou:", err);
      }
    }

    // === METODO 3: Web Speech API (voz sintetizada) ===
    try {
      await speakWithSynthesis(text);
      console.log("[Mina Voice] Audio reproduzido via speechSynthesis");
      return;
    } catch (err) {
      console.warn("[Mina Voice] speechSynthesis falhou:", err);
    }

    console.error("[Mina Voice] TODOS os metodos de audio falharam!");
  } finally {
    hideSpeakingIndicator();
  }
}

/** Toca audio base64 via elemento Audio HTML5 */
function playAudioElement(audioBase64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.volume = 1.0;

    audio.oncanplaythrough = () => {
      audio.play().then(() => {
        console.log("[Mina Voice] Audio element tocando...");
      }).catch((err) => {
        console.error("[Mina Voice] Audio element play() rejeitado:", err);
        reject(err);
      });
    };

    audio.onended = () => {
      console.log("[Mina Voice] Audio element finalizado");
      resolve();
    };

    audio.onerror = (e) => {
      console.error("[Mina Voice] Audio element erro:", e);
      reject(new Error("Audio element erro"));
    };

    // Timeout de seguranca
    const timeout = setTimeout(() => {
      reject(new Error("Audio element timeout (15s)"));
    }, 15000);

    audio.onended = () => {
      clearTimeout(timeout);
      resolve();
    };

    // Definir src por ultimo para iniciar o carregamento
    audio.src = audioBase64;
  });
}

/** Fala usando Web Speech API (speechSynthesis) */
function speakWithSynthesis(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("speechSynthesis nao disponivel"));
      return;
    }

    // Cancelar qualquer fala anterior
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Buscar voz em portugues
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find((v) => v.lang.startsWith("pt"));
    if (ptVoice) {
      utterance.voice = ptVoice;
    }

    // Timeout de seguranca (30s)
    const timeout = setTimeout(() => {
      window.speechSynthesis.cancel();
      reject(new Error("speechSynthesis timeout (30s)"));
    }, 30000);

    utterance.onend = () => {
      clearTimeout(timeout);
      resolve();
    };

    utterance.onerror = (e) => {
      clearTimeout(timeout);
      // "interrupted" nao e erro real — pode acontecer ao cancelar
      if (e.error === "interrupted") {
        resolve();
        return;
      }
      reject(new Error(`speechSynthesis erro: ${e.error}`));
    };

    window.speechSynthesis.speak(utterance);
    console.log("[Mina Voice] speechSynthesis iniciado:", text.substring(0, 50));
  });
}

// ========== Indicador visual ==========

function showSpeakingIndicator(): void {
  if (document.getElementById("mina-joyce-speaking")) return;

  const el = document.createElement("div");
  el.id = "mina-joyce-speaking";
  el.innerHTML = `
    <div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;align-items:center;gap:10px;padding:12px 20px;background:linear-gradient(135deg,rgba(0,212,170,0.95),rgba(255,107,157,0.95));border-radius:24px;backdrop-filter:blur(12px);font-family:'Google Sans',Roboto,sans-serif;font-size:14px;font-weight:600;color:#fff;box-shadow:0 8px 32px rgba(0,212,170,0.4);animation:mina-joyce-in 0.4s cubic-bezier(0.34,1.56,0.64,1);">
      <div style="display:flex;gap:3px;align-items:center;">
        <div style="width:3px;height:12px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out infinite;"></div>
        <div style="width:3px;height:18px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.1s infinite;"></div>
        <div style="width:3px;height:14px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.2s infinite;"></div>
        <div style="width:3px;height:20px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.3s infinite;"></div>
        <div style="width:3px;height:10px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.4s infinite;"></div>
      </div>
      <span>Joyce falando...</span>
    </div>
    <style>
      @keyframes mina-wave{0%,100%{transform:scaleY(1)}50%{transform:scaleY(0.4)}}
      @keyframes mina-joyce-in{from{opacity:0;transform:translateX(-50%) translateY(20px) scale(0.8)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
    </style>
  `;
  document.body.appendChild(el);
}

function hideSpeakingIndicator(): void {
  const el = document.getElementById("mina-joyce-speaking");
  if (el) {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.3s";
    setTimeout(() => el.remove(), 300);
  }
}
