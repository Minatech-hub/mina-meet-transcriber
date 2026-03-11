import { CaptionEntry } from "@/lib/types";

type CaptionCallback = (entry: CaptionEntry) => void;

/**
 * Observa as legendas (closed captions) do Google Meet via MutationObserver.
 *
 * Estrategia robusta:
 * 1. Procura o container de legendas por multiplos metodos (classe, aria, heuristica)
 * 2. Monitora alteracoes no texto
 * 3. Debounce: quando o texto para de mudar por ~1.5s, emite como fala completa
 * 4. Deduplicar falas repetidas
 * 5. Polling de fallback caso o MutationObserver falhe
 */
export class CaptionObserver {
  private bodyObserver: MutationObserver | null = null;
  private captionObserver: MutationObserver | null = null;
  private callback: CaptionCallback;
  private meetingStartTime: number;
  private lastTexts = new Map<string, string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private emittedHashes = new Set<string>();
  private captionContainer: Element | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private searchAttempts = 0;
  private maxSearchAttempts = 120; // 2 minutos de busca (a cada 1s)

  constructor(callback: CaptionCallback, meetingStartTime: number) {
    this.callback = callback;
    this.meetingStartTime = meetingStartTime;
  }

  start(): void {
    console.log("[Mina Meet Captions] Iniciando observacao de legendas...");

    // Tentar encontrar imediatamente
    this.findAndObserveCaptions();

    // Se nao encontrou, fazer polling ativo (mais confiavel que MutationObserver no body)
    if (!this.captionContainer) {
      this.pollInterval = setInterval(() => {
        this.searchAttempts++;
        if (this.captionContainer) {
          if (this.pollInterval) clearInterval(this.pollInterval);
          return;
        }

        this.findAndObserveCaptions();

        if (this.searchAttempts % 10 === 0) {
          console.log(`[Mina Meet Captions] Buscando container de legendas... (tentativa ${this.searchAttempts})`);
          // Tentar ativar legendas automaticamente
          this.tryEnableCaptions();
        }

        if (this.searchAttempts >= this.maxSearchAttempts) {
          console.warn("[Mina Meet Captions] Container nao encontrado apos 2 minutos. Legendas estao ativadas?");
          if (this.pollInterval) clearInterval(this.pollInterval);
        }
      }, 1000);
    }
  }

  stop(): void {
    this.bodyObserver?.disconnect();
    this.captionObserver?.disconnect();
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.bodyObserver = null;
    this.captionObserver = null;
    this.captionContainer = null;
    this.pollInterval = null;
  }

  /** Tenta ativar as legendas clicando no botao CC */
  tryEnableCaptions(): void {
    const selectors = [
      // Portugues
      'button[aria-label*="legenda" i]',
      'button[aria-label*="Ativar legendas" i]',
      'button[data-tooltip*="legenda" i]',
      'button[data-tooltip*="Ativar legendas" i]',
      // Ingles
      'button[aria-label*="caption" i]',
      'button[aria-label*="subtitle" i]',
      'button[aria-label*="Turn on captions" i]',
      'button[data-tooltip*="caption" i]',
      'button[data-tooltip*="Turn on captions" i]',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn) {
        // Verificar se ja esta ativado
        const pressed = btn.getAttribute("aria-pressed");
        if (pressed === "true") {
          console.log("[Mina Meet Captions] Legendas ja estao ativadas");
          return;
        }
        btn.click();
        console.log("[Mina Meet Captions] Legendas ativadas automaticamente via:", sel);
        return;
      }
    }

    // Fallback: procurar por botao com icone de CC nos controles inferiores
    const bottomBar = document.querySelector('[jscontroller][jsname]');
    if (bottomBar) {
      const buttons = bottomBar.querySelectorAll("button");
      for (const btn of buttons) {
        const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-tooltip") || "").toLowerCase();
        if (label.includes("cc") || label.includes("legenda") || label.includes("caption") || label.includes("subtitle")) {
          if (btn.getAttribute("aria-pressed") !== "true") {
            btn.click();
            console.log("[Mina Meet Captions] Legendas ativadas via fallback:", label);
            return;
          }
        }
      }
    }
  }

  private findAndObserveCaptions(): void {
    // Estrategia 1: seletores conhecidos por classe
    const classSelectors = [
      'div[class*="iOzk7"]',
      'div[class*="a4cQT"]',
      'div[class*="TBMuR"]',
      'div[class*="bh44bd"]',
    ];

    for (const sel of classSelectors) {
      const el = document.querySelector(sel);
      if (el && this.looksLikeCaptionContainer(el)) {
        this.attachObserver(el, `classe ${sel}`);
        return;
      }
    }

    // Estrategia 2: aria-live="polite" (padrao de acessibilidade)
    const ariaLive = document.querySelectorAll('[aria-live="polite"]');
    for (const el of ariaLive) {
      if (this.looksLikeCaptionContainer(el)) {
        this.attachObserver(el, "aria-live=polite");
        return;
      }
    }

    // Estrategia 3: heuristica — procurar container fixo na parte inferior com texto dinamico
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const style = window.getComputedStyle(div);
      // Container de legendas normalmente e fixed/absolute na parte inferior
      if (
        (style.position === "fixed" || style.position === "absolute") &&
        parseInt(style.bottom || "999") < 200 &&
        div.children.length > 0 &&
        div.children.length < 10 &&
        div.textContent &&
        div.textContent.length > 5 &&
        div.textContent.length < 500
      ) {
        // Verificar se tem estrutura de legenda (nome: texto)
        const text = div.textContent;
        if (text.includes(":") || div.querySelector("span, img")) {
          // Possivel container de legendas
          const hasNameAndText = Array.from(div.querySelectorAll("div, span")).some(
            (child) => {
              const ct = child.textContent?.trim() || "";
              return ct.length > 2 && ct.length < 50;
            }
          );
          if (hasNameAndText) {
            this.attachObserver(div, "heuristica posicao/conteudo");
            return;
          }
        }
      }
    }
  }

  /** Verifica se um elemento parece ser um container de legendas */
  private looksLikeCaptionContainer(el: Element): boolean {
    // Deve ter conteudo de texto
    const text = el.textContent?.trim() || "";
    if (text.length === 0) {
      // Container vazio pode ainda nao ter legendas, mas verificar se tem filhos
      return el.children.length > 0;
    }
    // Nao deve ser um elemento enorme (tipo o body)
    if (text.length > 1000) return false;
    return true;
  }

  private attachObserver(container: Element, method: string): void {
    this.captionContainer = container;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log(`[Mina Meet Captions] Container encontrado via ${method}`);

    this.captionObserver = new MutationObserver((mutations) => {
      this.handleCaptionMutations(mutations);
    });

    this.captionObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    });

    // Processar conteudo atual
    this.processCaptionContent();
  }

  private handleCaptionMutations(_mutations: MutationRecord[]): void {
    this.processCaptionContent();
  }

  private processCaptionContent(): void {
    if (!this.captionContainer) return;

    // Tentar extrair falas de todos os blocos filhos
    const blocks = this.captionContainer.querySelectorAll("div");
    const processed = new Set<string>();

    blocks.forEach((block) => {
      // Evitar processar sub-blocos
      if (processed.has(block.textContent || "")) return;

      const { speaker, text } = this.extractSpeakerAndText(block);
      if (!speaker || !text || text.length < 2) return;

      processed.add(block.textContent || "");

      const key = speaker;
      const currentText = this.lastTexts.get(key);

      if (currentText !== text) {
        this.lastTexts.set(key, text);

        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        this.debounceTimers.set(
          key,
          setTimeout(() => {
            this.emitCaption(speaker, text);
            this.lastTexts.delete(key);
            this.debounceTimers.delete(key);
          }, 1500)
        );
      }
    });
  }

  private extractSpeakerAndText(block: Element): { speaker: string; text: string } {
    const children = Array.from(block.children);

    // Padrao 1: primeiro filho = nome com estilo diferente, resto = texto
    if (children.length >= 2) {
      const firstChild = children[0];
      const speaker = firstChild?.textContent?.trim() || "";

      // O speaker normalmente e curto (nome da pessoa)
      if (speaker.length > 1 && speaker.length < 60 && !speaker.includes(".")) {
        const text = children
          .slice(1)
          .map((c) => c.textContent?.trim())
          .filter(Boolean)
          .join(" ");
        if (text && text.length > 1) return { speaker, text };
      }
    }

    // Padrao 2: imagem de perfil + nome + texto em spans
    const spans = block.querySelectorAll("span");
    if (spans.length >= 2) {
      const speaker = spans[0]?.textContent?.trim() || "";
      const textParts: string[] = [];
      for (let i = 1; i < spans.length; i++) {
        const t = spans[i]?.textContent?.trim();
        if (t) textParts.push(t);
      }
      const text = textParts.join(" ");
      if (speaker && text) return { speaker, text };
    }

    // Padrao 3: formato "Nome: texto"
    const fullText = block.textContent?.trim() || "";
    const colonIndex = fullText.indexOf(":");
    if (colonIndex > 0 && colonIndex < 50) {
      return {
        speaker: fullText.slice(0, colonIndex).trim(),
        text: fullText.slice(colonIndex + 1).trim(),
      };
    }

    return { speaker: "", text: "" };
  }

  private emitCaption(speaker: string, text: string): void {
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

    console.log(`[Mina Meet Captions] ${speaker}: "${text}"`);
    this.callback(entry);
  }
}
