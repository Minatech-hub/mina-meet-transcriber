import { CaptionEntry } from "@/lib/types";

type CaptionCallback = (entry: CaptionEntry) => void;

/**
 * Captura legendas do Google Meet via MutationObserver no DOM.
 *
 * Metodo identico ao Tactiq.io:
 * 1. Legendas DEVEM estar ativadas (CC) no Meet
 * 2. Localiza o container de legendas por jsname/classe especificos
 * 3. MutationObserver captura mudancas de texto em tempo real
 * 4. Extrai speaker + texto de cada bloco
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

  // Palavras que indicam que NAO e um container de legendas
  // (textos de botoes, controles do Meet, etc.)
  private static BLACKLIST_WORDS = [
    "desativar microfone", "ativar microfone", "desativar câmera", "ativar câmera",
    "sair da chamada", "compartilhar tela", "mais opções", "levantar a mão",
    "enviar uma reação", "configurações de áudio", "configurações de vídeo",
    "turn off microphone", "turn on microphone", "leave call", "share screen",
    "mute", "unmute", "hang up", "more options", "raise hand",
    "keyboard_arrow_up", "call_end", "more_vert", "back_hand",
    "extensão para o meet", "complemento funcionaria",
    "ctrl + d", "ctrl + e",
  ];

  // Seletores ESPECIFICOS para legendas (nao controles)
  private static CAPTION_SELECTORS = [
    'div[jsname="dsyhDe"]',
    'div[jsname="tgaKEf"]',
    'div[jscontroller="TEjq6e"]',
    'div[jscontroller="kAPMuc"]',
    'div.a4cQT',
    'div.iOzk7',
  ];

  // Seletores para speaker
  private static SPEAKER_SELECTORS = [
    'div.KcIKyf.jxFHg',
    '.zs7s8d.jxFHg',
    '.NWpY1d',
    '.xoMHSc',
    '.KcIKyf',
    '.jxFHg',
  ];

  // Seletores para blocos individuais de legenda
  private static BLOCK_SELECTORS = [
    'div.nMcdL.bj4p3b',
    'div.nMcdL',
    '.CNusmb',
    'div.bj4p3b',
  ];

  constructor(callback: CaptionCallback, meetingStartTime: number) {
    this.callback = callback;
    this.meetingStartTime = meetingStartTime;
  }

  start(): void {
    console.log("[Mina Captions] Iniciando (modo Tactiq)...");

    this.findContainer();

    this.pollInterval = setInterval(() => {
      this.searchAttempts++;

      if (this.captionContainer) {
        if (!document.contains(this.captionContainer)) {
          console.log("[Mina Captions] Container perdido, rebuscando...");
          this.captionContainer = null;
          this.observer?.disconnect();
          this.observer = null;
          this.findContainer();
        }
        return;
      }

      this.findContainer();

      if (this.searchAttempts % 10 === 0) {
        this.tryEnableCaptions();
        if (this.searchAttempts <= 120) {
          console.log(`[Mina Captions] Buscando legendas... (${this.searchAttempts / 2}s)`);
          this.dumpCandidates();
        }
      }
    }, 500);

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
    const labels = [
      "legenda", "caption", "subtitle", "subtítulo",
      "ativar legenda", "turn on caption", "activar subtítulo",
    ];

    for (const btn of document.querySelectorAll("button")) {
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      const tooltip = (btn.getAttribute("data-tooltip") || "").toLowerCase();
      const combined = `${aria} ${tooltip}`;

      for (const label of labels) {
        if (combined.includes(label)) {
          if (btn.getAttribute("aria-pressed") === "true" || combined.includes("desativar") || combined.includes("turn off")) {
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
  }

  /** Verifica se o texto de um elemento parece ser de controles do Meet (nao legenda) */
  private isBlacklisted(text: string): boolean {
    const lower = text.toLowerCase();
    return CaptionObserver.BLACKLIST_WORDS.some((w) => lower.includes(w));
  }

  /** Verifica se um elemento parece ser um container de legendas valido */
  private isValidCaptionContainer(el: Element): boolean {
    const text = el.textContent?.trim() || "";

    // Muito longo — provavelmente pegou a pagina inteira ou controles
    if (text.length > 500) return false;

    // Texto vazio — pode ser container vazio esperando legendas
    if (text.length === 0) return true;

    // Contem texto de controles/botoes — NAO e legenda
    if (this.isBlacklisted(text)) return false;

    // Contem material icons (nomes como "mic", "videocam", "call_end") — NAO e legenda
    if (/\b(mic|videocam|call_end|more_vert|back_hand|closed_caption|keyboard_arrow|computer_arrow)\b/.test(text)) {
      return false;
    }

    return true;
  }

  /** Procura o container de legendas */
  private findContainer(): void {
    // 1. Seletores especificos de legendas
    for (const sel of CaptionObserver.CAPTION_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && this.isValidCaptionContainer(el)) {
        this.attachObserver(el, sel);
        return;
      }
    }

    // 2. Procurar por blocos de legenda e subir ao pai
    for (const sel of CaptionObserver.BLOCK_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.parentElement && this.isValidCaptionContainer(el.parentElement)) {
        this.attachObserver(el.parentElement, `parent(${sel})`);
        return;
      }
    }

    // 3. Procurar por nomes de speaker e subir ao container
    for (const sel of CaptionObserver.SPEAKER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        // Subir 2-3 niveis
        let parent = el.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
          if (this.isValidCaptionContainer(parent) && parent.children.length > 0 && parent.children.length < 15) {
            const rect = parent.getBoundingClientRect();
            if (rect.height > 15 && rect.top > window.innerHeight * 0.4) {
              this.attachObserver(parent, `ancestor(${sel})`);
              return;
            }
          }
          parent = parent.parentElement;
        }
      }
    }

    // 4. Fallback: aria-live na parte inferior da tela, mas VALIDAR conteudo
    for (const el of document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]')) {
      if (!this.isValidCaptionContainer(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.5 && rect.height > 10 && rect.height < 300) {
        this.attachObserver(el, `aria-live (validado)`);
        return;
      }
    }
  }

  private attachObserver(container: Element, method: string): void {
    if (this.captionContainer === container) return;

    this.captionContainer = container;
    this.observer?.disconnect();

    console.log(`[Mina Captions] Container ENCONTRADO via: ${method}`);
    console.log(`[Mina Captions] Tag=${container.tagName} class="${(container.className || "").substring(0, 60)}" filhos=${container.children.length}`);

    const text = container.textContent?.trim() || "";
    if (text) {
      console.log(`[Mina Captions] Texto atual: "${text.substring(0, 100)}"`);
    }

    this.hideCaptionHint();

    this.observer = new MutationObserver(() => {
      this.processContainer();
    });

    this.observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    this.processContainer();
  }

  private processContainer(): void {
    if (!this.captionContainer) return;

    // Revalidar — se o container agora tem conteudo de controles, descartar
    if (!this.isValidCaptionContainer(this.captionContainer)) {
      console.log("[Mina Captions] Container invalidado (conteudo de controles). Rebuscando...");
      this.captionContainer = null;
      this.observer?.disconnect();
      this.observer = null;
      return;
    }

    let entries = this.extractByBlocks(this.captionContainer);

    if (entries.length === 0) {
      entries = this.extractByChildren(this.captionContainer);
    }

    if (entries.length === 0) {
      const { speaker, text } = this.extractSpeakerText(this.captionContainer);
      if (text.length >= 2 && !this.isBlacklisted(text)) {
        entries.push({ speaker: speaker || "Participante", text });
      }
    }

    for (const { speaker, text } of entries) {
      if (text.length < 2 || this.isBlacklisted(text)) continue;

      const key = speaker;
      const prev = this.lastTexts.get(key);
      if (prev === text) continue;
      this.lastTexts.set(key, text);

      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      this.debounceTimers.set(key, setTimeout(() => {
        this.emit(speaker, text);
        this.lastTexts.delete(key);
        this.debounceTimers.delete(key);
      }, 1500));
    }
  }

  private extractByBlocks(container: Element): Array<{ speaker: string; text: string }> {
    const results: Array<{ speaker: string; text: string }> = [];

    for (const sel of CaptionObserver.BLOCK_SELECTORS) {
      const blocks = container.querySelectorAll(sel);
      if (blocks.length === 0) continue;

      blocks.forEach((block) => {
        const { speaker, text } = this.extractSpeakerText(block);
        if (text.length >= 2 && !this.isBlacklisted(text)) {
          results.push({ speaker: speaker || "Participante", text });
        }
      });

      if (results.length > 0) return results;
    }

    return results;
  }

  private extractByChildren(container: Element): Array<{ speaker: string; text: string }> {
    const results: Array<{ speaker: string; text: string }> = [];

    for (const child of container.children) {
      if (!(child instanceof HTMLElement)) continue;
      const { speaker, text } = this.extractSpeakerText(child);
      if (text.length >= 2 && !this.isBlacklisted(text)) {
        results.push({ speaker: speaker || "Participante", text });
      }
    }

    return results;
  }

  private extractSpeakerText(el: Element): { speaker: string; text: string } {
    // 1. Buscar speaker por seletores conhecidos
    for (const sel of CaptionObserver.SPEAKER_SELECTORS) {
      const speakerEl = el.querySelector(sel);
      if (speakerEl) {
        const speaker = speakerEl.textContent?.trim() || "";
        if (speaker.length > 0 && speaker.length < 60) {
          const fullText = el.textContent?.trim() || "";
          const text = fullText.replace(speaker, "").trim();
          if (text.length >= 2) return { speaker, text };
        }
      }
    }

    // 2. Primeiro filho = nome, resto = texto
    const children = Array.from(el.children);
    if (children.length >= 2) {
      const first = children[0]?.textContent?.trim() || "";
      if (first.length > 0 && first.length < 50 && !this.isBlacklisted(first)) {
        const rest = children.slice(1).map(c => c.textContent?.trim()).filter(Boolean).join(" ");
        if (rest.length >= 2 && !this.isBlacklisted(rest)) {
          return { speaker: first, text: rest };
        }
      }
    }

    // 3. Spans
    const spans = el.querySelectorAll(":scope > span, :scope > div > span");
    if (spans.length >= 2) {
      const speaker = spans[0]?.textContent?.trim() || "";
      if (speaker.length > 0 && speaker.length < 50 && !this.isBlacklisted(speaker)) {
        const texts: string[] = [];
        for (let i = 1; i < spans.length; i++) {
          const t = spans[i]?.textContent?.trim();
          if (t && !this.isBlacklisted(t)) texts.push(t);
        }
        if (texts.length > 0) return { speaker, text: texts.join(" ") };
      }
    }

    // 4. "Nome: texto"
    const full = el.textContent?.trim() || "";
    const colon = full.indexOf(":");
    if (colon > 0 && colon < 50 && full.length < 400) {
      const speaker = full.slice(0, colon).trim();
      const text = full.slice(colon + 1).trim();
      if (!this.isBlacklisted(speaker) && !this.isBlacklisted(text) && text.length >= 2) {
        return { speaker, text };
      }
    }

    // 5. Texto puro curto (sem speaker)
    if (full.length >= 2 && full.length < 300 && !this.isBlacklisted(full)) {
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

    console.log(`[Mina Captions] CAPTURADO — ${speaker}: "${text}"`);
    this.callback(entry);
  }

  /** Loga candidatos para debug */
  private dumpCandidates(): void {
    // Listar elementos com jsname
    const jsnames: string[] = [];
    document.querySelectorAll("[jsname]").forEach((el) => {
      const name = el.getAttribute("jsname");
      const text = (el.textContent?.trim() || "").substring(0, 40);
      const rect = el.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.4 && text.length > 0 && text.length < 200 && !this.isBlacklisted(text)) {
        jsnames.push(`jsname="${name}" → "${text}"`);
      }
    });

    if (jsnames.length > 0) {
      console.log(`[Mina Captions] Elementos jsname na parte inferior (possiveis legendas):`);
      jsnames.slice(0, 5).forEach((s) => console.log(`  ${s}`));
    }

    // Listar classes de elementos na parte inferior
    const bottomEls: string[] = [];
    document.querySelectorAll("div").forEach((div) => {
      const rect = div.getBoundingClientRect();
      const text = (div.textContent?.trim() || "");
      if (
        rect.top > window.innerHeight * 0.6 &&
        rect.top < window.innerHeight - 50 &&
        rect.height > 15 &&
        rect.height < 150 &&
        text.length > 2 &&
        text.length < 200 &&
        div.children.length > 0 &&
        div.children.length < 10 &&
        !this.isBlacklisted(text)
      ) {
        const cls = (div.className || "").substring(0, 40);
        bottomEls.push(`<div class="${cls}"> → "${text.substring(0, 60)}"`);
      }
    });

    if (bottomEls.length > 0) {
      console.log(`[Mina Captions] Divs no bottom com texto (possiveis legendas):`);
      bottomEls.slice(0, 5).forEach((s) => console.log(`  ${s}`));
    }
  }

  private showCaptionHint(): void {
    if (document.getElementById("mina-caption-hint")) return;
    const hint = document.createElement("div");
    hint.id = "mina-caption-hint";
    hint.innerHTML = `
      <div style="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 20px;background:rgba(0,0,0,0.92);border:2px solid #00d4aa;border-radius:14px;backdrop-filter:blur(12px);font-family:'Google Sans',Roboto,sans-serif;font-size:13px;color:#fff;text-align:center;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.6);animation:mina-hint-in 0.5s ease;">
        <div style="color:#00d4aa;font-weight:700;margin-bottom:6px;font-size:14px;">Mina Transcriber + Joyce</div>
        <div>Ative as <strong style="color:#00d4aa;">legendas (CC)</strong> no Meet para capturar falas e acionar a Joyce.</div>
        <div style="margin-top:8px;font-size:11px;color:#aaa;">Botao CC na barra inferior ou tecle C</div>
      </div>
      <style>@keyframes mina-hint-in{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}</style>
    `;
    document.body.appendChild(hint);
    setTimeout(() => this.hideCaptionHint(), 25000);
  }

  private hideCaptionHint(): void {
    const hint = document.getElementById("mina-caption-hint");
    if (hint) {
      hint.style.transition = "opacity 0.5s";
      hint.style.opacity = "0";
      setTimeout(() => hint.remove(), 500);
    }
  }
}
