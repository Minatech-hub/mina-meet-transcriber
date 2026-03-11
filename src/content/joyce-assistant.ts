import { CaptionEntry, JoyceCommand } from "@/lib/types";

type JoyceCallback = (command: JoyceCommand) => void;

/**
 * Modulo de deteccao de comandos para a Joyce durante a reuniao.
 *
 * Monitora as legendas capturadas e detecta quando alguem menciona "Joyce"
 * seguido de um comando ou pergunta. Ao detectar, coleta o contexto recente
 * e emite um JoyceCommand para processamento.
 *
 * Padroes reconhecidos:
 * - "Joyce, cria uma tarefa de..."
 * - "Joyce qual o status do projeto?"
 * - "Joyce anota isso..."
 * - "ei Joyce, ..."
 * - "Joyce!" (aguarda a proxima frase do mesmo speaker)
 */
export class JoyceAssistant {
  private callback: JoyceCallback;
  private recentEntries: CaptionEntry[] = [];
  private maxContext = 20; // ultimas 20 falas para contexto
  private isProcessing = false;
  private cooldownMs = 5000; // 5s entre comandos para evitar spam
  private lastCommandTime = 0;

  // Padroes para detectar chamada a Joyce
  private static TRIGGER_PATTERNS = [
    /\bjoyce\b/i,
    /\bjóyce\b/i,
    /\bjoice\b/i, // variacao fonetica comum
  ];

  // Padroes para ignorar (falsos positivos)
  private static IGNORE_PATTERNS = [
    /joyce\s+(falou|disse|comentou|mencionou)/i, // referindo a algo que Joyce disse
  ];

  constructor(callback: JoyceCallback) {
    this.callback = callback;
  }

  /** Alimenta uma nova fala capturada — verifica se contem comando para Joyce */
  feed(entry: CaptionEntry): void {
    this.recentEntries.push(entry);

    // Manter buffer limitado
    if (this.recentEntries.length > this.maxContext) {
      this.recentEntries = this.recentEntries.slice(-this.maxContext);
    }

    // Verificar se contem trigger
    if (this.containsTrigger(entry.text)) {
      this.handleTrigger(entry);
    }
  }

  /** Limpa o buffer de contexto */
  reset(): void {
    this.recentEntries = [];
    this.isProcessing = false;
  }

  private containsTrigger(text: string): boolean {
    // Verificar se contem o nome "Joyce"
    const hasTrigger = JoyceAssistant.TRIGGER_PATTERNS.some((p) => p.test(text));
    if (!hasTrigger) return false;

    // Verificar se nao e um falso positivo
    const isIgnored = JoyceAssistant.IGNORE_PATTERNS.some((p) => p.test(text));
    return !isIgnored;
  }

  private handleTrigger(entry: CaptionEntry): void {
    // Cooldown para evitar multiplos triggers rapidos
    const now = Date.now();
    if (now - this.lastCommandTime < this.cooldownMs) {
      console.log("[Mina Meet Joyce] Cooldown ativo, ignorando trigger");
      return;
    }

    if (this.isProcessing) {
      console.log("[Mina Meet Joyce] Ja processando um comando, ignorando");
      return;
    }

    this.lastCommandTime = now;
    this.isProcessing = true;

    // Extrair o comando (texto apos "Joyce")
    const command = this.extractCommand(entry.text);

    if (!command || command.length < 3) {
      // "Joyce" foi dito sem comando claro — aguardar proxima fala do mesmo speaker
      console.log("[Mina Meet Joyce] Trigger detectado sem comando, aguardando continuacao...");
      this.waitForFollowUp(entry.speaker);
      return;
    }

    this.emitCommand(entry.speaker, command);
  }

  /** Extrai o texto do comando apos "Joyce" */
  private extractCommand(text: string): string {
    // Remover tudo antes de "Joyce" (incluindo "Joyce" e virgulas/pontuacao)
    const match = text.match(/\bjo[yi]ce\b[,!?\s]*(.*)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return "";
  }

  /** Aguarda a proxima fala do mesmo speaker como continuacao do comando */
  private waitForFollowUp(speaker: string): void {
    const originalLength = this.recentEntries.length;
    let attempts = 0;
    const maxWait = 8000; // 8s no maximo

    const check = setInterval(() => {
      attempts++;

      // Verificar se houve nova fala do mesmo speaker
      const newEntries = this.recentEntries.slice(originalLength);
      const followUp = newEntries.find(
        (e) => e.speaker.toLowerCase() === speaker.toLowerCase()
      );

      if (followUp) {
        clearInterval(check);
        this.emitCommand(speaker, followUp.text);
        return;
      }

      // Timeout
      if (attempts * 500 >= maxWait) {
        clearInterval(check);
        this.isProcessing = false;
        console.log("[Mina Meet Joyce] Timeout aguardando continuacao do comando");
      }
    }, 500);
  }

  private emitCommand(speaker: string, command: string): void {
    console.log(`[Mina Meet Joyce] Comando de ${speaker}: "${command}"`);

    const joyceCommand: JoyceCommand = {
      speaker,
      command,
      recentContext: [...this.recentEntries.slice(-10)], // ultimas 10 falas como contexto
    };

    this.callback(joyceCommand);

    // Reset processing apos um tempo (para permitir novos comandos)
    setTimeout(() => {
      this.isProcessing = false;
    }, 3000);
  }
}
