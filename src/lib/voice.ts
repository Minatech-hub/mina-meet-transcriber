/**
 * Modulo de voz — reproduz respostas da Joyce por audio.
 *
 * Estrategia:
 * 1. Se tem audioBase64 (ElevenLabs TTS): tocar localmente via Audio element
 *    + tentar injetar no pipeline Meet (para todos ouvirem)
 * 2. Se nao tem audio: usar Web Speech API (speechSynthesis)
 *
 * Audio LOCAL (usuario ouve) e SEMPRE tocado primeiro.
 * Pipeline Meet (todos ouvem) e tentado em paralelo como bonus.
 */

import { tryInjectIntoMeetPipeline } from "@/content/audio-injector";

// Pre-carregar vozes do speechSynthesis (Chrome bug: getVoices() retorna vazio no inicio)
let voicesLoaded = false;
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) voicesLoaded = true;
  };
  loadVoices();
  window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

export async function playJoyceResponse(text: string, audioBase64?: string): Promise<void> {
  showSpeakingIndicator();

  try {
    if (audioBase64) {
      // Tocar audio localmente (usuario ouve com certeza)
      const localPromise = playAudioElement(audioBase64);

      // Em paralelo, tentar injetar no Meet (todos ouvem)
      tryInjectIntoMeetPipeline(audioBase64).catch((err) => {
        console.warn("[Mina Voice] Pipeline Meet falhou (ok, audio local tocando):", err);
      });

      try {
        await localPromise;
        console.log("[Mina Voice] Audio local reproduzido com sucesso");
        return;
      } catch (err) {
        console.warn("[Mina Voice] Audio element falhou:", err);
        // Cair para speechSynthesis
      }
    }

    // Fallback: Web Speech API (voz sintetizada)
    await speakWithSynthesis(text);
    console.log("[Mina Voice] Audio reproduzido via speechSynthesis");
  } catch (err) {
    console.error("[Mina Voice] TODOS os metodos falharam:", err);
    // Ultima tentativa: speechSynthesis direto, sem await
    lastResortSpeak(text);
  } finally {
    hideSpeakingIndicator();
  }
}

/** Toca audio base64 via elemento Audio HTML5 (usuario ouve localmente) */
function playAudioElement(audioBase64: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const audio = new Audio();
      audio.volume = 1.0;

      const timeout = setTimeout(() => {
        audio.pause();
        audio.src = "";
        reject(new Error("Audio element timeout (20s)"));
      }, 20000);

      audio.onended = () => {
        clearTimeout(timeout);
        console.log("[Mina Voice] Audio element finalizado");
        resolve();
      };

      audio.onerror = (e) => {
        clearTimeout(timeout);
        console.error("[Mina Voice] Audio element erro:", e);
        reject(new Error("Audio element erro"));
      };

      // Definir src inicia o carregamento
      audio.src = audioBase64;

      // Tentar play assim que possivel
      const playPromise = audio.play();
      if (playPromise) {
        playPromise
          .then(() => console.log("[Mina Voice] Audio element tocando..."))
          .catch((err) => {
            clearTimeout(timeout);
            console.error("[Mina Voice] Audio element play() rejeitado:", err);
            reject(err);
          });
      }
    } catch (err) {
      reject(err);
    }
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

    // Chrome bug: speechSynthesis pode "pausar" em textos longos
    // Workaround: manter alive com resume periodico
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        // tudo ok
      } else if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 5000);

    utterance.onend = () => {
      clearTimeout(timeout);
      clearInterval(keepAlive);
      resolve();
    };

    utterance.onerror = (e) => {
      clearTimeout(timeout);
      clearInterval(keepAlive);
      // "interrupted" nao e erro real — pode acontecer ao cancelar
      if (e.error === "interrupted" || e.error === "canceled") {
        resolve();
        return;
      }
      reject(new Error(`speechSynthesis erro: ${e.error}`));
    };

    window.speechSynthesis.speak(utterance);
    console.log("[Mina Voice] speechSynthesis iniciado:", text.substring(0, 50));

    // Chrome bug: verificar se realmente comecou
    setTimeout(() => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        console.warn("[Mina Voice] speechSynthesis nao iniciou, tentando novamente");
        window.speechSynthesis.speak(utterance);
      }
    }, 200);
  });
}

/** Ultima tentativa — fire and forget, sem promise */
function lastResortSpeak(text: string): void {
  try {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      u.volume = 1.0;
      window.speechSynthesis.speak(u);
      console.log("[Mina Voice] lastResortSpeak disparado");
    }
  } catch {
    // silencioso — nao ha mais o que fazer
  }
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
