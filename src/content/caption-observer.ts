import { CaptionEntry } from "@/lib/types";

type CaptionCallback = (entry: CaptionEntry) => void;

/**
 * Observa as legendas (closed captions) do Google Meet via MutationObserver.
 *
 * Estrategia ultra-robusta com multiplas camadas de deteccao:
 * 1. Monitoramento global de TODOS os novos elementos adicionados ao DOM
 * 2. Deteccao por taxa de mudanca de texto (legendas mudam rapidamente)
 * 3. Seletores conhecidos (com fallback)
 * 4. Deteccao heuristica por posicao/estrutura
 * 5. Logging detalhado para debug
 */
export class CaptionObserver {
  private globalObserver: MutationObserver | null = null;
  private captionObserver: MutationObserver | null = null;
  private callback: CaptionCallback;
  private meetingStartTime: number;
  private lastTexts = new Map<string, string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private emittedHashes = new Set<string>();
  private captionContainer: Element | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private searchAttempts = 0;
  private maxSearchAttempts = 300; // 5 minutos de busca (a cada 1s)

  // Rastrear elementos com texto que muda para detectar legendas
  private textChangeTracker = new Map<Element, { text: string; changes: number; firstSeen: number }>();

  constructor(callback: CaptionCallback, meetingStartTime: number) {
    this.callback = callback;
    this.meetingStartTime = meetingStartTime;
  }

  start(): void {
    console.log("[Mina Meet Captions] Iniciando observacao de legendas...");
    console.log("[Mina Meet Captions] URL:", window.location.href);

    // Estrategia 1: Tentar encontrar container por seletores conhecidos
    this.findAndObserveCaptions();

    // Estrategia 2: Monitoramento global — observar TODOS os novos elementos
    this.startGlobalMonitoring();

    // Estrategia 3: Polling ativo para buscar container periodicamente
    this.pollInterval = setInterval(() => {
      this.searchAttempts++;

      if (this.captionContainer) {
        // Verificar se container ainda esta no DOM
        if (!document.contains(this.captionContainer)) {
          console.log("[Mina Meet Captions] Container removido do DOM, rebuscando...");
          this.captionContainer = null;
          this.captionObserver?.disconnect();
          this.captionObserver = null;
        } else {
          return; // Tudo OK
        }
      }

      this.findAndObserveCaptions();

      // A cada 5s, tentar ativar legendas e logar status
      if (this.searchAttempts % 5 === 0) {
        console.log(`[Mina Meet Captions] Buscando legendas... (${this.searchAttempts}s)`);
        this.tryEnableCaptions();
        this.logDOMStatus();
      }

      if (this.searchAttempts >= this.maxSearchAttempts) {
        console.warn("[Mina Meet Captions] Container nao encontrado apos 5 minutos.");
        // Continuar tentando mas com menor frequencia
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => {
          this.findAndObserveCaptions();
          this.tryEnableCaptions();
        }, 10000);
      }
    }, 1000);
  }

  stop(): void {
    this.globalObserver?.disconnect();
    this.captionObserver?.disconnect();
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.globalObserver = null;
    this.captionObserver = null;
    this.captionContainer = null;
    this.pollInterval = null;
    this.textChangeTracker.clear();
  }

  /** Tenta ativar as legendas clicando no botao CC */
  tryEnableCaptions(): void {
    // Metodo 1: Seletores por aria-label/data-tooltip
    const selectors = [
      // Portugues
      'button[aria-label*="legenda" i]',
      'button[aria-label*="Ativar legendas" i]',
      'button[aria-label*="Mostrar legendas" i]',
      'button[data-tooltip*="legenda" i]',
      'button[data-tooltip*="Ativar legendas" i]',
      // Ingles
      'button[aria-label*="caption" i]',
      'button[aria-label*="subtitle" i]',
      'button[aria-label*="Turn on captions" i]',
      'button[data-tooltip*="caption" i]',
      'button[data-tooltip*="Turn on captions" i]',
      // Espanhol
      'button[aria-label*="subtítulo" i]',
      'button[aria-label*="subtitulo" i]',
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel) as HTMLButtonElement | null;
      if (btn) {
        const pressed = btn.getAttribute("aria-pressed");
        if (pressed === "true") {
          console.log("[Mina Meet Captions] Legendas ja estao ativadas (aria-pressed=true)");
          return;
        }
        console.log("[Mina Meet Captions] Clicando botao de legendas:", sel);
        btn.click();
        return;
      }
    }

    // Metodo 2: Procurar botoes na barra inferior por texto/SVG
    const allButtons = document.querySelectorAll("button");
    for (const btn of allButtons) {
      const label = (
        btn.getAttribute("aria-label") ||
        btn.getAttribute("data-tooltip") ||
        btn.textContent ||
        ""
      ).toLowerCase();

      if (
        label.includes("cc") ||
        label.includes("legenda") ||
        label.includes("caption") ||
        label.includes("subtitle") ||
        label.includes("subtítulo")
      ) {
        if (btn.getAttribute("aria-pressed") !== "true") {
          console.log("[Mina Meet Captions] Ativando legendas via botao encontrado:", label);
          btn.click();
          return;
        } else {
          console.log("[Mina Meet Captions] Botao de legendas ja ativo:", label);
          return;
        }
      }
    }

    // Metodo 3: atalho de teclado (Ctrl+C no Meet ativa/desativa legendas)
    // Nota: nem sempre funciona dependendo do foco
    console.log("[Mina Meet Captions] Nenhum botao de legendas encontrado. Tentando atalho Ctrl+C...");
    try {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "c",
          code: "KeyC",
          ctrlKey: false, // No Meet, e apenas "c" sem Ctrl
          bubbles: true,
        })
      );
    } catch (_e) {
      // Ignorar erros do atalho
    }
  }

  /** Monitoramento global do DOM — detecta containers de legendas quando aparecem */
  private startGlobalMonitoring(): void {
    this.globalObserver = new MutationObserver((mutations) => {
      if (this.captionContainer) return; // Ja encontrou

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            this.checkIfCaptionContainer(node);
          }
        }

        // Tambem checar mudancas de texto em elementos existentes
        if (mutation.type === "characterData" && mutation.target.parentElement) {
          this.trackTextChange(mutation.target.parentElement);
        }
      }
    });

    this.globalObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    });
  }

  /** Rastreia mudancas de texto para identificar legendas (mudam com alta frequencia) */
  private trackTextChange(el: Element): void {
    if (this.captionContainer) return;

    // Subir ate o container pai relevante (max 5 niveis)
    let container = el;
    for (let i = 0; i < 5; i++) {
      const parent = container.parentElement;
      if (!parent || parent === document.body) break;

      // Se o pai tem posicao fixa/absoluta e esta na parte inferior, usar ele
      const style = window.getComputedStyle(parent);
      if (style.position === "fixed" || style.position === "absolute") {
        const rect = parent.getBoundingClientRect();
        if (rect.top > window.innerHeight * 0.5) {
          container = parent;
          break;
        }
      }
      container = parent;
    }

    const now = Date.now();
    const tracker = this.textChangeTracker.get(container);
    const currentText = container.textContent?.trim() || "";

    if (tracker) {
      if (tracker.text !== currentText) {
        tracker.text = currentText;
        tracker.changes++;

        // Se o texto mudou 3+ vezes em 10s, provavelmente e legenda
        if (tracker.changes >= 3 && now - tracker.firstSeen < 10000) {
          console.log(
            `[Mina Meet Captions] Detectado elemento com texto dinamico (${tracker.changes} mudancas):`,
            currentText.substring(0, 80)
          );
          this.attachObserver(container, "deteccao por taxa de mudanca");
          this.textChangeTracker.clear();
        }
      }
    } else {
      this.textChangeTracker.set(container, {
        text: currentText,
        changes: 1,
        firstSeen: now,
      });
    }

    // Limpar trackers antigos
    if (this.textChangeTracker.size > 50) {
      for (const [key, val] of this.textChangeTracker) {
        if (now - val.firstSeen > 15000) {
          this.textChangeTracker.delete(key);
        }
      }
    }
  }

  /** Verifica se um elemento recem-adicionado e um container de legendas */
  private checkIfCaptionContainer(el: HTMLElement): void {
    if (this.captionContainer) return;

    // Verificar o elemento e todos os seus filhos
    const candidates = [el, ...Array.from(el.querySelectorAll("div"))];

    for (const candidate of candidates) {
      // Check 1: Tem aria-live=polite (padrao de acessibilidade para legendas)
      if (candidate.getAttribute("aria-live") === "polite") {
        const text = candidate.textContent?.trim() || "";
        if (text.length > 0 && text.length < 500) {
          this.attachObserver(candidate, "aria-live=polite (novo elemento)");
          return;
        }
      }

      // Check 2: Classes conhecidas do Meet
      const className = candidate.className || "";
      if (
        typeof className === "string" &&
        (className.includes("iOzk7") ||
          className.includes("a4cQT") ||
          className.includes("TBMuR") ||
          className.includes("bh44bd") ||
          className.includes("Mz6pEf") ||
          className.includes("iTTPOb"))
      ) {
        this.attachObserver(candidate, `classe conhecida: ${className}`);
        return;
      }

      // Check 3: Posicao na parte inferior + conteudo de texto
      const rect = candidate.getBoundingClientRect();
      if (
        rect.top > window.innerHeight * 0.65 &&
        rect.height > 20 &&
        rect.height < 300 &&
        candidate.children.length > 0 &&
        candidate.children.length < 15
      ) {
        const text = candidate.textContent?.trim() || "";
        if (text.length > 3 && text.length < 500) {
          // Provavelmente legenda — verificar se tem estrutura de nome:texto
          if (this.hasNameTextStructure(candidate)) {
            this.attachObserver(candidate, "heuristica novo elemento (posicao + estrutura)");
            return;
          }
        }
      }
    }
  }

  /** Verifica se um elemento tem estrutura de legenda (nome + texto) */
  private hasNameTextStructure(el: Element): boolean {
    // Padrao 1: filhos com texto curto (nome) + texto longo (fala)
    const children = Array.from(el.children);
    if (children.length >= 2) {
      const first = children[0].textContent?.trim() || "";
      const second = children.slice(1).map(c => c.textContent?.trim()).join(" ");
      if (first.length > 1 && first.length < 50 && second.length > 2) {
        return true;
      }
    }

    // Padrao 2: texto contem ":" (Nome: texto)
    const text = el.textContent?.trim() || "";
    const colonIdx = text.indexOf(":");
    if (colonIdx > 0 && colonIdx < 50 && text.length > colonIdx + 3) {
      return true;
    }

    // Padrao 3: tem spans/divs com textos separados
    const spans = el.querySelectorAll("span, div");
    if (spans.length >= 2) {
      const texts = Array.from(spans).map(s => s.textContent?.trim()).filter(Boolean);
      if (texts.length >= 2) return true;
    }

    return false;
  }

  private findAndObserveCaptions(): void {
    // Estrategia 1: seletores conhecidos por classe
    const classSelectors = [
      'div[class*="iOzk7"]',
      'div[class*="a4cQT"]',
      'div[class*="TBMuR"]',
      'div[class*="bh44bd"]',
      'div[class*="Mz6pEf"]',
      'div[class*="iTTPOb"]',
      // Seletores por jsname (mais estaveis que classes)
      'div[jsname="tgaKEf"]',
      'div[jsname="dsyhDe"]',
    ];

    for (const sel of classSelectors) {
      const el = document.querySelector(sel);
      if (el && this.looksLikeCaptionContainer(el)) {
        this.attachObserver(el, `seletor ${sel}`);
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

    // Estrategia 3: aria-live="assertive"
    const ariaAssertive = document.querySelectorAll('[aria-live="assertive"]');
    for (const el of ariaAssertive) {
      if (this.looksLikeCaptionContainer(el)) {
        this.attachObserver(el, "aria-live=assertive");
        return;
      }
    }

    // Estrategia 4: role="region" com conteudo de texto
    const regions = document.querySelectorAll('[role="region"]');
    for (const el of regions) {
      const rect = el.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.5 && this.looksLikeCaptionContainer(el)) {
        this.attachObserver(el, 'role="region"');
        return;
      }
    }

    // Estrategia 5: heuristica por posicao — container fixo/absoluto na parte inferior
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const rect = div.getBoundingClientRect();

      // Container de legendas normalmente esta na parte inferior da tela
      if (
        rect.top > window.innerHeight * 0.65 &&
        rect.top < window.innerHeight - 10 &&
        rect.height > 20 &&
        rect.height < 250 &&
        rect.width > window.innerWidth * 0.2
      ) {
        const style = window.getComputedStyle(div);
        // Geralmente fixed ou absolute
        if (style.position === "fixed" || style.position === "absolute") {
          const text = div.textContent?.trim() || "";
          if (text.length > 3 && text.length < 500 && div.children.length > 0 && div.children.length < 15) {
            if (this.hasNameTextStructure(div)) {
              this.attachObserver(div, "heuristica posicao inferior");
              return;
            }
          }
        }
      }
    }
  }

  /** Verifica se um elemento parece ser um container de legendas */
  private looksLikeCaptionContainer(el: Element): boolean {
    const text = el.textContent?.trim() || "";

    // Container vazio com filhos — pode ser o container esperando legendas
    if (text.length === 0 && el.children.length > 0) {
      return true;
    }

    // Nao deve ser um elemento enorme (tipo o body)
    if (text.length > 1000) return false;

    // Verificar posicao — legendas ficam na parte inferior
    const rect = el.getBoundingClientRect();
    if (rect.height > 0 && rect.top < window.innerHeight * 0.3) {
      // Muito acima na tela — provavelmente nao e legenda
      // A menos que seja um overlay
      const style = window.getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "absolute") {
        return false;
      }
    }

    return true;
  }

  private attachObserver(container: Element, method: string): void {
    if (this.captionContainer === container) return; // Ja observando este

    this.captionContainer = container;
    this.captionObserver?.disconnect();

    console.log(`[Mina Meet Captions] ✓ Container encontrado via ${method}`);
    console.log(`[Mina Meet Captions] Container:`, container.tagName, container.className);
    console.log(`[Mina Meet Captions] Conteudo atual:`, (container.textContent || "").substring(0, 100));

    this.captionObserver = new MutationObserver(() => {
      this.processCaptionContent();
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

  private processCaptionContent(): void {
    if (!this.captionContainer) return;

    // Tentar extrair falas de todos os blocos
    // Abordagem: pegar os "leaf blocks" — divs que contem texto mas nao contem outros divs com texto
    const entries = this.extractAllCaptionEntries(this.captionContainer);

    for (const { speaker, text } of entries) {
      if (!speaker || !text || text.length < 2) continue;

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
    }
  }

  /** Extrai todas as entradas de legenda de um container */
  private extractAllCaptionEntries(container: Element): Array<{ speaker: string; text: string }> {
    const results: Array<{ speaker: string; text: string }> = [];

    // Abordagem 1: procurar blocos filhos diretos que parecem legendas individuais
    const directChildren = Array.from(container.children);
    for (const child of directChildren) {
      if (child instanceof HTMLElement) {
        const entry = this.extractSpeakerAndText(child);
        if (entry.speaker && entry.text && entry.text.length >= 2) {
          results.push(entry);
        } else {
          // Tentar um nivel mais fundo
          for (const grandchild of child.children) {
            if (grandchild instanceof HTMLElement) {
              const entry2 = this.extractSpeakerAndText(grandchild);
              if (entry2.speaker && entry2.text && entry2.text.length >= 2) {
                results.push(entry2);
              }
            }
          }
        }
      }
    }

    // Se nao encontrou nada, tentar o container inteiro como uma unica legenda
    if (results.length === 0) {
      const entry = this.extractSpeakerAndText(container);
      if (entry.speaker && entry.text) {
        results.push(entry);
      }
    }

    return results;
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
      if (speaker && text && speaker.length < 60) return { speaker, text };
    }

    // Padrao 3: imagem + div com nome + div com texto
    const img = block.querySelector("img");
    if (img) {
      const divs = Array.from(block.querySelectorAll("div")).filter(
        (d) => d.textContent?.trim() && d.children.length === 0
      );
      if (divs.length >= 2) {
        return {
          speaker: divs[0].textContent?.trim() || "",
          text: divs.slice(1).map(d => d.textContent?.trim()).join(" "),
        };
      }
    }

    // Padrao 4: formato "Nome: texto"
    const fullText = block.textContent?.trim() || "";
    const colonIndex = fullText.indexOf(":");
    if (colonIndex > 0 && colonIndex < 50) {
      const speaker = fullText.slice(0, colonIndex).trim();
      const text = fullText.slice(colonIndex + 1).trim();
      if (speaker && text) return { speaker, text };
    }

    // Padrao 5: Apenas texto (sem speaker identificavel) — usar "Participante"
    if (fullText.length > 3 && fullText.length < 300 && children.length === 0) {
      // Verificar se nao e um botao ou label
      const tag = block.tagName.toLowerCase();
      if (tag !== "button" && tag !== "label" && tag !== "a") {
        return { speaker: "Participante", text: fullText };
      }
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

    console.log(`[Mina Meet Captions] ✓ Capturado — ${speaker}: "${text}"`);
    this.callback(entry);
  }

  /** Log detalhado do estado do DOM para debug */
  private logDOMStatus(): void {
    // Contar elementos relevantes
    const ariaLive = document.querySelectorAll('[aria-live]');
    const regions = document.querySelectorAll('[role="region"]');
    const videos = document.querySelectorAll('video');
    const fixedElements: string[] = [];

    // Procurar elementos fixed na parte inferior com texto
    document.querySelectorAll('div').forEach((div) => {
      const rect = div.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.6 && rect.height > 15 && rect.height < 300) {
        const style = window.getComputedStyle(div);
        if (style.position === "fixed" || style.position === "absolute") {
          const text = div.textContent?.trim() || "";
          if (text.length > 0 && text.length < 200) {
            fixedElements.push(`[${div.tagName}.${div.className?.substring?.(0, 30) || ""}] "${text.substring(0, 50)}"`);
          }
        }
      }
    });

    console.log("[Mina Meet Captions] === STATUS DOM ===");
    console.log(`  aria-live elements: ${ariaLive.length}`);
    console.log(`  role=region elements: ${regions.length}`);
    console.log(`  videos: ${videos.length}`);
    console.log(`  fixed/abs na parte inferior: ${fixedElements.length}`);
    if (fixedElements.length > 0) {
      fixedElements.forEach(f => console.log(`    → ${f}`));
    }

    // Listar aria-live elements
    ariaLive.forEach(el => {
      const text = el.textContent?.trim() || "(vazio)";
      console.log(`  aria-live="${el.getAttribute('aria-live')}": ${el.tagName}.${(el.className || "").substring(0, 30)} → "${text.substring(0, 80)}"`);
    });
  }
}
