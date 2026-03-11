import { CaptionEntry } from "@/lib/types";

type CaptionCallback = (entry: CaptionEntry) => void;

/**
 * Captura de fala via Web Speech API (SpeechRecognition).
 *
 * Funciona independente do DOM do Google Meet — escuta o microfone
 * diretamente e converte fala em texto em tempo real.
 *
 * Vantagens:
 * - Nao depende dos seletores CSS do Meet (que mudam frequentemente)
 * - Funciona mesmo sozinho na reuniao
 * - Captura a fala do usuario local com alta precisao
 *
 * Limitacao:
 * - Captura apenas o microfone local (nao os outros participantes)
 * - Para outros participantes, o CaptionObserver continua tentando
 */
export class SpeechCapture {
  private recognition: any = null; // SpeechRecognition
  private callback: CaptionCallback;
  private meetingStartTime: number;
  private isRunning = false;
  private restartAttempts = 0;
  private maxRestartAttempts = 50;
  private userName = "Eu";
  private emittedHashes = new Set<string>();

  constructor(callback: CaptionCallback, meetingStartTime: number) {
    this.callback = callback;
    this.meetingStartTime = meetingStartTime;
  }

  /** Define o nome do usuario local (para identificar o speaker) */
  setUserName(name: string): void {
    this.userName = name;
  }

  /** Verifica se o navegador suporta Web Speech API */
  static isSupported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  start(): void {
    if (!SpeechCapture.isSupported()) {
      console.error("[Mina Speech] Web Speech API nao suportada neste navegador");
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "pt-BR";
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isRunning = true;
      this.restartAttempts = 0;
      console.log("[Mina Speech] Reconhecimento de fala ativo — escutando microfone");
    };

    this.recognition.onresult = (event: any) => {
      this.handleResults(event);
    };

    this.recognition.onerror = (event: any) => {
      console.warn("[Mina Speech] Erro:", event.error);

      // "no-speech" e normal — apenas ninguem falou
      if (event.error === "no-speech") {
        return;
      }

      // "aborted" pode acontecer ao trocar de aba
      if (event.error === "aborted") {
        return;
      }

      // "not-allowed" — usuario negou permissao de microfone
      if (event.error === "not-allowed") {
        console.error("[Mina Speech] Permissao de microfone negada");
        this.isRunning = false;
        return;
      }
    };

    this.recognition.onend = () => {
      // Reiniciar automaticamente se a reuniao ainda esta ativa
      if (this.isRunning && this.restartAttempts < this.maxRestartAttempts) {
        this.restartAttempts++;
        setTimeout(() => {
          if (this.isRunning) {
            try {
              this.recognition?.start();
            } catch {
              // Pode falhar se ja esta rodando
            }
          }
        }, 300);
      }
    };

    try {
      this.recognition.start();
    } catch (err) {
      console.error("[Mina Speech] Erro ao iniciar:", err);
    }
  }

  stop(): void {
    this.isRunning = false;
    try {
      this.recognition?.stop();
    } catch {
      // Ignorar
    }
    this.recognition = null;
  }

  private handleResults(event: any): void {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();

      if (!text || text.length < 2) continue;

      // Resultado final (frase completa) — emitir
      if (result.isFinal) {
        this.emitCaption(text);
      }
    }
  }

  private emitCaption(text: string): void {
    // Deduplicar
    const hash = `${this.userName}:${text}`;
    if (this.emittedHashes.has(hash)) return;
    this.emittedHashes.add(hash);

    // Limpar hashes antigos
    if (this.emittedHashes.size > 300) {
      const arr = Array.from(this.emittedHashes);
      this.emittedHashes = new Set(arr.slice(-150));
    }

    const entry: CaptionEntry = {
      timestamp: Date.now() - this.meetingStartTime,
      speaker: this.userName,
      text,
      capturedAt: new Date().toISOString(),
    };

    console.log(`[Mina Speech] Capturado: "${text}"`);
    this.callback(entry);
  }
}
