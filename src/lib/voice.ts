/**
 * Modulo de voz — reproduz respostas da Joyce por audio.
 *
 * Duas estrategias:
 * 1. ElevenLabs API (qualidade alta, voz natural) — audio gerado no backend
 * 2. Web Speech API (fallback local, sem custo) — voz sintetizada no navegador
 *
 * O audio e reproduzido localmente no navegador do usuario (nao vai para o Meet).
 */

/** Reproduz audio a partir de base64 data URL */
export function playAudioFromBase64(base64Audio: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(base64Audio);
    audio.volume = 0.8;

    audio.onended = () => resolve();
    audio.onerror = (e) => reject(e);

    audio.play().catch(reject);
  });
}

/** Reproduz audio a partir de ArrayBuffer */
export function playAudioFromBuffer(buffer: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = 0.8;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    audio.play().catch(reject);
  });
}

/**
 * Fallback: usa Web Speech API do navegador para falar o texto.
 * Funciona offline e sem custo, mas a voz e sintetica.
 */
export function speakWithWebSpeech(text: string, lang = "pt-BR"): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("Web Speech API nao suportada"));
      return;
    }

    // Cancelar fala anterior se houver
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1.05; // levemente mais rapido que o padrao
    utterance.pitch = 1.1; // tom levemente mais alto (feminino)
    utterance.volume = 0.85;

    // Tentar encontrar uma voz feminina em portugues
    const voices = window.speechSynthesis.getVoices();
    const ptFemale = voices.find(
      (v) => v.lang.startsWith("pt") && v.name.toLowerCase().includes("female")
    );
    const ptVoice = ptFemale || voices.find((v) => v.lang.startsWith("pt"));
    if (ptVoice) {
      utterance.voice = ptVoice;
    }

    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(e);

    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Reproduz a resposta da Joyce — tenta audio do backend primeiro, fallback para Web Speech.
 */
export async function playJoyceResponse(text: string, audioBase64?: string): Promise<void> {
  // Mostrar indicador visual de que Joyce esta falando
  showSpeakingIndicator();

  try {
    if (audioBase64) {
      await playAudioFromBase64(audioBase64);
    } else {
      await speakWithWebSpeech(text);
    }
  } finally {
    hideSpeakingIndicator();
  }
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
        <div class="mina-wave-bar" style="width:3px;height:12px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out infinite;"></div>
        <div class="mina-wave-bar" style="width:3px;height:18px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.1s infinite;"></div>
        <div class="mina-wave-bar" style="width:3px;height:14px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.2s infinite;"></div>
        <div class="mina-wave-bar" style="width:3px;height:20px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.3s infinite;"></div>
        <div class="mina-wave-bar" style="width:3px;height:10px;background:#fff;border-radius:2px;animation:mina-wave 0.8s ease-in-out 0.4s infinite;"></div>
      </div>
      <span>Joyce esta falando...</span>
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
