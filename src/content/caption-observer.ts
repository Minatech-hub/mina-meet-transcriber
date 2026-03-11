import { CaptionEntry } from "@/lib/types";

type CaptionCallback = (entry: CaptionEntry) => void;

/**
 * Captura legendas do Google Meet via MutationObserver no DOM.
 *
 * Abordagem identica ao Tactiq.io e TranscripTonic:
 * 1. Legendas do Meet DEVEM estar ativadas (CC)
 * 2. Localiza o container de legendas por jsname/classe/role
 * 3. MutationObserver detecta novos blocos de legenda
 * 4. Extrai speaker e texto de cada bloco
 *
 * Seletores baseados em projetos open-source ativos em 2024-2025:
 * - gmeet-transcription-extension (jsname="dsyhDe", "tgaKEf")
 * - TranscripTonic (div.bh44bd, div.nMcdL)
 * - alert-me-google-meet (jscontroller="TEjq6e", .CNusmb)
 * - recall.ai (.NWpY1d, .xoMHSc)
 */
export class CaptionObserver {
  private callback: CaptionCallback;
  private meetingStartTime: number;
  private observer: MutationObserver | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private captionContainer: Element | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastTexts = new Map<string, string>();
  private emittedHashes = new Set<string>();
  private searchAttempts = 0;

  // Seletores para o container de legendas (ordem de prioridade)
  private static CONTAINER_SELECTORS = [
    // jsname — mais estaveis que classes CSS
    'div[jsname="dsyhDe"]',         // container principal de legendas
    'div[jsname="tgaKEf"]',         // div de texto de legenda
    // jscontroller
    'div[jscontroller="TEjq6e"]',   // controller de legendas
    'div[jscontroller="kAPMuc"]',   // controller alternativo
    // Classes conhecidas (menos estaveis)
    'div.a4cQT',                     // container de legendas
    'div.iOzk7',                     // container alternativo
    'div.bh44bd',                    // bloco de legenda
    // Role/aria
    'div[role="region"][tabindex="0"]', // painel de transcricao
    // Fallback aria-live
    'div[aria-live="polite"]',
    'div[aria-live="assertive"]',
  ];

  // Seletores para nome do speaker dentro de um bloco de legenda
  private static SPEAKER_SELECTORS = [
    'div.KcIKyf.jxFHg',    // nome do speaker (gmeet-transcription, TranscripTonic)
    '.zs7s8d.jxFHg',        // speaker (alert-me)
    '.NWpY1d',               // speaker (recall.ai)
    '.xoMHSc',               // speaker alternativo
    'div.KcIKyf',            // fallback
    '.jxFHg',                // fallback
  ];

  // Seletores para bloco individual de legenda (um por speaker)
  private static BLOCK_SELECTORS = [
    'div.nMcdL.bj4p3b',     // bloco por speaker (TranscripTonic)
    'div.nMcdL',             // bloco alternativo
    '.CNusmb',               // bloco (alert-me)
    'div.bj4p3b',            // bloco alternativo
  ];

  constructor(callback: CaptionCallback, meetingStartTime: number) {
    this.callback = callback;
    this.meetingStartTime = meetingStartTime;
  }

  start(): void {
    console.log("[Mina Captions] Iniciando captura de legendas (modo Tactiq)...");

    // Tentar encontrar container imediatamente
    this.findContainer();

    // Polling para encontrar container se nao achou
    this.pollInterval = setInterval(() => {
      this.searchAttempts++;

      if (this.captionContainer) {
        // Verificar se container ainda esta no DOM
        if (!document.contains(this.captionContainer)) {
          console.log("[Mina Captions] Container removido, rebuscando...");
          this.captionContainer = null;
          this.observer?.disconnect();
          this.observer = null;
          this.findContainer();
        }
        return;
      }

      this.findContainer();

      // A cada 5s, tentar ativar legendas e logar
      if (this.searchAttempts % 10 === 0) {
        this.tryEnableCaptions();
        if (this.searchAttempts <= 60) {
          console.log(`[Mina Captions] Buscando legendas... (${this.searchAttempts / 2}s) — Ative as legendas (CC) no Meet!`);
        }
      }
    }, 500);

    // Mostrar aviso visual
    this.showCaptionHint();
  }

  stop(): void {
    this.observer?.disconnect();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.debounceTimers.forEach((t) => clearTimeout(t));
    this.debounceTimers.clear();
    this.observer = null;
    this.captionContainer = null;
    this.pollInterval = null;
    this.hideCaptionHint();
  }

  tryEnableCaptions(): void {
    // Metodo 1: buscar botao por label em varios idiomas
    const labels = [
      "legenda", "caption", "subtitle", "subtítulo", "subtitulo",
      "cc", "closed caption", "ativar legenda", "turn on caption",
    ];

    const allButtons = document.querySelectorAll("button");
    for (const btn of allButtons) {
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (btn.getAttribute("data-tooltip") || "").toLowerCase();
      const combined = `${aria} ${tooltip}`;

      for (const label of labels) {
        if (combined.includes(label)) {
          if (btn.getAttribute("aria-pressed") === "true") {
            console.log("[Mina Captions] Legendas ja ativas");
            this.hideCaptionHint();
            return;
          }
          console.log("[Mina Captions] Ativando legendas:", combined.trim());
          btn.click();
          this.hideCaptionHint();
          return;
        }
      }
    }

    // Metodo 2: atalho Shift+C (toggle captions)
    if (this.searchAttempts > 20 && this.searchAttempts % 40 === 0) {
      console.log("[Mina Captions] Tentando atalho de teclado...");
      // Meet usa 'c' (sem shift) para toggle captions
      const event = new KeyboardEvent("keydown", {
        key: "c",
        code: "KeyC",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
    }
  }

  /** Procura o container de legendas no DOM */
  private findContainer(): void {
    // Tentar seletores conhecidos
    for (const sel of CaptionObserver.CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        // Verificar se esta visivel e na parte inferior
        if (rect.height > 0) {
          this.attachObserver(el, sel);
          return;
        }
      }
    }

    // Fallback: procurar por blocos de legenda individuais
    for (const sel of CaptionObserver.BLOCK_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        // Subir ao container pai
        const parent = el.parentElement;
        if (parent) {
          this.attachObserver(parent, `parent of ${sel}`);
          return;
        }
      }
    }

    // Fallback final: procurar qualquer div com speaker selector
    for (const sel of CaptionObserver.SPEAKER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        // Subir 2-3 niveis para achar o container
        let container = el.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          if (container.children.length > 0 && container.children.length < 20) {
            const rect = container.getBoundingClientRect();
            if (rect.height > 20 && rect.top > window.innerHeight * 0.4) {
              this.attachObserver(container, `ancestor of ${sel}`);
              return;
            }
          }
          container = container.parentElement;
        }
      }
    }
  }

  private attachObserver(container: Element, method: string): void {
    if (this.captionContainer === container) return;

    this.captionContainer = container;
    this.observer?.disconnect();

    console.log(`[Mina Captions] Container encontrado via: ${method}`);
    console.log(`[Mina Captions] Tag: ${container.tagName}, class: ${(container.className || "").substring(0, 50)}`);
    this.hideCaptionHint();

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Novos nos adicionados (novos blocos de legenda)
        if (mutation.addedNodes.length > 0) {
          this.processContainer();
        }
        // Texto mudou (legenda sendo digitada em tempo real)
        if (mutation.type === "characterData" || mutation.type === "childList") {
          this.processContainer();
        }
      }
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Processar conteudo atual
    this.processContainer();
  }

  /** Processa todos os blocos de legenda no container */
  private processContainer(): void {
    if (!this.captionContainer) return;

    // Tentar extrair por blocos conhecidos
    let entries = this.extractByBlocks(this.captionContainer);

    // Fallback: extrair por filhos diretos
    if (entries.length === 0) {
      entries = this.extractByChildren(this.captionContainer);
    }

    // Fallback final: container inteiro
    if (entries.length === 0) {
      const { speaker, text } = this.extractSpeakerText(this.captionContainer);
      if (text.length >= 2) {
        entries.push({ speaker: speaker || "Participante", text });
      }
    }

    for (const { speaker, text } of entries) {
      if (text.length < 2) continue;

      const key = speaker;
      const prev = this.lastTexts.get(key);
      if (prev === text) continue;
      this.lastTexts.set(key, text);

      // Debounce — esperar texto parar de mudar
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(key, setTimeout(() => {
        this.emit(speaker, text);
        this.lastTexts.delete(key);
        this.debounceTimers.delete(key);
      }, 1500));
    }
  }

  /** Extrai legendas por seletores de bloco conhecidos */
  private extractByBlocks(container: Element): Array<{ speaker: string; text: string }> {
    const results: Array<{ speaker: string; text: string }> = [];

    for (const sel of CaptionObserver.BLOCK_SELECTORS) {
      const blocks = container.querySelectorAll(sel);
      if (blocks.length === 0) continue;

      blocks.forEach((block) => {
        const { speaker, text } = this.extractSpeakerText(block);
        if (text.length >= 2) {
          results.push({ speaker: speaker || "Participante", text });
        }
      });

      if (results.length > 0) return results;
    }

    return results;
  }

  /** Extrai legendas dos filhos diretos do container */
  private extractByChildren(container: Element): Array<{ speaker: string; text: string }> {
    const results: Array<{ speaker: string; text: string }> = [];

    for (const child of container.children) {
      if (!(child instanceof HTMLElement)) continue;
      const { speaker, text } = this.extractSpeakerText(child);
      if (text.length >= 2) {
        results.push({ speaker: speaker || "Participante", text });
      }
    }

    return results;
  }

  /** Extrai speaker e texto de um bloco de legenda */
  private extractSpeakerText(el: Element): { speaker: string; text: string } {
    // Metodo 1: buscar speaker por seletores conhecidos
    for (const sel of CaptionObserver.SPEAKER_SELECTORS) {
      const speakerEl = el.querySelector(sel);
      if (speakerEl) {
        const speaker = speakerEl.textContent?.trim() || "";
        if (speaker.length > 0 && speaker.length < 60) {
          // Texto = tudo exceto o speaker
          const fullText = el.textContent?.trim() || "";
          const text = fullText.replace(speaker, "").trim();
          if (text.length >= 2) return { speaker, text };
        }
      }
    }

    // Metodo 2: primeiro filho = nome, resto = texto
    const children = Array.from(el.children);
    if (children.length >= 2) {
      const first = children[0]?.textContent?.trim() || "";
      if (first.length > 0 && first.length < 60) {
        const rest = children.slice(1).map(c => c.textContent?.trim()).filter(Boolean).join(" ");
        if (rest.length >= 2) return { speaker: first, text: rest };
      }
    }

    // Metodo 3: spans
    const spans = el.querySelectorAll(":scope > span, :scope > div > span");
    if (spans.length >= 2) {
      const speaker = spans[0]?.textContent?.trim() || "";
      if (speaker.length > 0 && speaker.length < 60) {
        const texts: string[] = [];
        for (let i = 1; i < spans.length; i++) {
          const t = spans[i]?.textContent?.trim();
          if (t) texts.push(t);
        }
        if (texts.length > 0) return { speaker, text: texts.join(" ") };
      }
    }

    // Metodo 4: "Nome: texto"
    const full = el.textContent?.trim() || "";
    const colon = full.indexOf(":");
    if (colon > 0 && colon < 50) {
      return {
        speaker: full.slice(0, colon).trim(),
        text: full.slice(colon + 1).trim(),
      };
    }

    // Metodo 5: texto puro
    if (full.length >= 2 && full.length < 500) {
      return { speaker: "", text: full };
    }

    return { speaker: "", text: "" };
  }

  private emit(speaker: string, text: string): void {
    const hash = `${speaker}:${text}`;
    if (this.emittedHashes.has(hash)) return;
    this.emittedHashes.add(hash);

    if (this.emittedHashes.size > 500) {
      const arr = Array.from(this.emittedHashes);
      this.emittedHashes = new Set(arr.slice(-250));
    }

    const entry: CaptionEntry = {
      timestamp: Date.now() - this.meetingStartTime,
      speaker,
      text,
      capturedAt: new Date().toISOString(),
    };

    console.log(`[Mina Captions] ${speaker}: "${text}"`);
    this.callback(entry);
  }

  /** Aviso visual para ativar legendas */
  private showCaptionHint(): void {
    if (document.getElementById("mina-caption-hint")) return;

    const hint = document.createElement("div");
    hint.id = "mina-caption-hint";
    hint.innerHTML = `
      <div style="
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        padding: 12px 20px;
        background: rgba(0, 0, 0, 0.92);
        border: 2px solid #00d4aa;
        border-radius: 14px;
        backdrop-filter: blur(12px);
        font-family: 'Google Sans', Roboto, Arial, sans-serif;
        font-size: 13px;
        color: #fff;
        text-align: center;
        max-width: 340px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 20px rgba(0,212,170,0.15);
        animation: mina-hint-in 0.5s ease;
      ">
        <div style="color: #00d4aa; font-weight: 700; margin-bottom: 6px; font-size: 14px;">
          Mina Transcriber + Joyce
        </div>
        <div>Ative as <strong style="color: #00d4aa;">legendas (CC)</strong> no Meet para que eu possa ouvir e transcrever a reuniao.</div>
        <div style="margin-top: 8px; font-size: 11px; color: #aaa;">
          Botao CC na barra inferior do Google Meet
        </div>
      </div>
      <style>
        @keyframes mina-hint-in {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      </style>
    `;
    document.body.appendChild(hint);
    setTimeout(() => this.hideCaptionHint(), 25000);
  }

  private hideCaptionHint(): void {
    const hint = document.getElementById("mina-caption-hint");
    if (hint) {
      hint.style.transition = "opacity 0.5s ease";
      hint.style.opacity = "0";
      setTimeout(() => hint.remove(), 500);
    }
  }
}
