/**
 * Modulo de voz — reproduz respostas da Joyce por audio.
 *
 * Modo principal: injeta audio no stream do Meet via Web Audio API
 *   → TODOS os participantes da reuniao ouvem
 *
 * Fallback: Web Speech API local (se ElevenLabs indisponivel)
 *   → apenas o usuario local ouve
 *
 * O audio do ElevenLabs e gerado no backend (Edge Function) e enviado
 * como base64. O audio-injector decodifica e mixa com o microfone.
 */

import { injectJoyceAudio } from "@/content/audio-injector";

/**
 * Reproduz a resposta da Joyce — injeta no stream do Meet para todos ouvirem.
 * Se nao for possivel injetar, faz fallback local.
 */
export async function playJoyceResponse(text: string, audioBase64?: string): Promise<void> {
  showSpeakingIndicator();

  try {
    // Tentar injetar no stream do Meet (todos ouvem)
    await injectJoyceAudio(audioBase64, text);
  } catch (err) {
    console.error("[Mina Meet Voice] Erro ao injetar audio:", err);
    // Fallback final: Web Speech local
    try {
      await speakWithWebSpeechLocal(text);
    } catch {
      // Silencioso — ja logamos o erro
    }
  } finally {
    hideSpeakingIndicator();
  }
}

/** Fallback: Web Speech API local (apenas o usuario ouve) */
function speakWithWebSpeechLocal(text: string, lang = "pt-BR"): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("Web Speech API nao suportada"));
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
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

/** Indicador visual de que Joyce esta falando */
function showSpeakingIndicator(): void {
  let indicator = document.getElementById("mina-joyce-speaking");
  if (indicator) return;

  indicator = document.createElement("div");
  indicator.id = "mina-joyce-speaking";
  indicator.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 20px;
      background: linear-gradient(135deg, rgba(0,212,170,0.95), rgba(255,107,157,0.95));
      border-radius: 24px;
      backdrop-filter: blur(12px);
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      box-shadow: 0 8px 32px rgba(0,212,170,0.4);
      animation: mina-joyce-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    ">
      <div style="display:flex;gap:3px;align-items:center;">
        <div style="width:3px;height:12px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out infinite;"></div>
        <div style="width:3px;height:18px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.1s infinite;"></div>
        <div style="width:3px;height:14px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.2s infinite;"></div>
        <div style="width:3px;height:20px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.3s infinite;"></div>
        <div style="width:3px;height:10px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.4s infinite;"></div>
      </div>
      <span>Joyce falando na reuniao...</span>
    </div>
    <style>
      @keyframes mina-wave {
        0%, 100% { transform: scaleY(1); }
        50% { transform: scaleY(0.4); }
      }
      @keyframes mina-joyce-in {
        from { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.8); }
        to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }
    </style>
  `;

  document.body.appendChild(indicator);
}

function hideSpeakingIndicator(): void {
  const indicator = document.getElementById("mina-joyce-speaking");
  if (indicator) {
    indicator.style.opacity = "0";
    indicator.style.transition = "opacity 0.3s ease";
    setTimeout(() => indicator.remove(), 300);
  }
}
