import { CaptionEntry } from "@/lib/types";

type CaptionCallback = (entry: CaptionEntry) => void;

/**
 * Observa as legendas (closed captions) do Google Meet via MutationObserver.
 *
 * O Meet renderiza legendas em um container que contem divs com:
 * - Nome do speaker (primeiro filho ou atributo)
 * - Texto da legenda (atualizado em tempo real conforme a pessoa fala)
 *
 * Estrategia:
 * 1. Observar o DOM ate encontrar o container de legendas
 * 2. Monitorar alteracoes no texto
 * 3. Debounce: quando o texto para de mudar por ~1.5s, emite como fala completa
 * 4. Deduplicar falas repetidas
 */
export class CaptionObserver {
  private bodyObserver: MutationObserver | null = null;
  private captionObserver: MutationObserver | null = null;
  private callback: CaptionCallback;
  private meetingStartTime: number;
  private lastTexts = new Map<string, string>(); // speaker -> ultimo texto
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private emittedHashes = new Set<string>();
  private captionContainer: Element | null = null;

  // Seletores conhecidos do Google Meet para o container de legendas
  // Estes podem mudar entre versoes do Meet — a extensao usa multiplas estrategias
  private static CAPTION_SELECTORS = [
    '[jscontroller][jsname] div[class*="iOzk7"]', // container principal de legendas
    'div[class*="a4cQT"]', // container alternativo
    'div[aria-live="polite"]', // acessibilidade — legendas usam aria-live
  ];

  constructor(callback: CaptionCallback, meetingStartTime: number) {
    this.callback = callback;
    this.meetingStartTime = meetingStartTime;
  }

  /** Inicia a observacao — procura o container de legendas no DOM */
  start(): void {
    // Tentar encontrar imediatamente
    this.findAndObserveCaptions();

    // Se nao encontrou, observar o body para detectar quando aparecer
    if (!this.captionContainer) {
      this.bodyObserver = new MutationObserver(() => {
        if (!this.captionContainer) {
          this.findAndObserveCaptions();
        }
      });

      this.bodyObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  /** Para toda observacao */
  stop(): void {
    this.bodyObserver?.disconnect();
    this.captionObserver?.disconnect();
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();
    this.bodyObserver = null;
    this.captionObserver = null;
    this.captionContainer = null;
  }

  /** Tenta ativar as legendas clicando no botao CC */
  tryEnableCaptions(): void {
    // Botao de legendas do Meet — procura por aria-label ou data-tooltip
    const selectors = [
      'button[aria-label*="legenda" i]',
      'button[aria-label*="caption" i]',
      'button[aria-label*="subtitle" i]',
      'button[data-tooltip*="legenda" i]',
      'button[data-tooltip*="caption" i]',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn && btn.getAttribute("aria-pressed") !== "true") {
        btn.click();
        console.log("[Mina Meet] Legendas ativadas automaticamente");
        return;
      }
    }

    console.log("[Mina Meet] Botao de legendas nao encontrado — aguardando ativacao manual");
  }

  private findAndObserveCaptions(): void {
    for (const selector of CaptionObserver.CAPTION_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) {
        this.captionContainer = container;
        this.observeCaptionContainer(container);
        this.bodyObserver?.disconnect();
        this.bodyObserver = null;
        console.log("[Mina Meet] Container de legendas encontrado:", selector);
        return;
      }
    }

    // Fallback: procurar por aria-live="polite" que e o padrao de acessibilidade
    const ariaLive = document.querySelector('[aria-live="polite"]');
    if (ariaLive) {
      this.captionContainer = ariaLive;
      this.observeCaptionContainer(ariaLive);
      this.bodyObserver?.disconnect();
      this.bodyObserver = null;
      console.log("[Mina Meet] Container de legendas encontrado via aria-live");
    }
  }

  private observeCaptionContainer(container: Element): void {
    this.captionObserver = new MutationObserver((mutations) => {
      this.handleCaptionMutations(mutations);
    });

    this.captionObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    });
  }

  private handleCaptionMutations(_mutations: MutationRecord[]): void {
    if (!this.captionContainer) return;

    // Extrair falas ativas do container
    // Cada fala e um bloco com nome do speaker + texto
    const captionBlocks = this.captionContainer.querySelectorAll("div");

    captionBlocks.forEach((block) => {
      const { speaker, text } = this.extractSpeakerAndText(block);
      if (!speaker || !text) return;

      const key = speaker;
      const currentText = this.lastTexts.get(key);

      // Se o texto mudou, reiniciar debounce
      if (currentText !== text) {
        this.lastTexts.set(key, text);

        // Limpar timer anterior
        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        // Novo debounce: se o texto nao mudar por 1.5s, emitir
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

    if (children.length >= 2) {
      // Padrao comum: primeiro filho = nome, segundo = texto
      const speaker = children[0]?.textContent?.trim() || "";
      const text = children
        .slice(1)
        .map((c) => c.textContent?.trim())
        .filter(Boolean)
        .join(" ");
      if (speaker && text) return { speaker, text };
    }

    // Fallback: tentar extrair pelo formato "Nome: texto"
    const fullText = block.textContent?.trim() || "";
    const colonIndex = fullText.indexOf(":");
    if (colonIndex > 0 && colonIndex < 40) {
      return {
        speaker: fullText.slice(0, colonIndex).trim(),
        text: fullText.slice(colonIndex + 1).trim(),
      };
    }

    return { speaker: "", text: "" };
  }

  private emitCaption(speaker: string, text: string): void {
    // Deduplicacao por hash
    const hash = `${speaker}:${text}`;
    if (this.emittedHashes.has(hash)) return;
    this.emittedHashes.add(hash);

    // Limpar hashes antigos para evitar memory leak (manter ultimos 500)
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

    this.callback(entry);
  }
}
