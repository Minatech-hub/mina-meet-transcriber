/**
 * Detecta inicio e fim de reunioes no Google Meet.
 *
 * Inicio: presenca dos controles de chamada (botao de desligar, microfone)
 * Fim: desaparecimento dos controles ou mudanca de URL
 */
export class MeetingDetector {
  private observer: MutationObserver | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isInMeeting = false;
  private onStart: (title: string) => void;
  private onEnd: () => void;

  // Seletores para detectar que o usuario esta em uma chamada ativa
  private static IN_CALL_SELECTORS = [
    'button[aria-label*="desligar" i]',
    'button[aria-label*="leave" i]',
    'button[aria-label*="hang up" i]',
    'button[data-tooltip*="desligar" i]',
    '[data-call-active="true"]',
  ];

  constructor(onStart: (title: string) => void, onEnd: () => void) {
    this.onStart = onStart;
    this.onEnd = onEnd;
  }

  start(): void {
    // Poll a cada 2s para detectar entrada/saida da chamada
    this.pollInterval = setInterval(() => this.checkMeetingState(), 2000);
    this.checkMeetingState();
  }

  stop(): void {
    this.observer?.disconnect();
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.observer = null;
    this.pollInterval = null;
  }

  private checkMeetingState(): void {
    const inCall = this.isUserInCall();

    if (inCall && !this.isInMeeting) {
      this.isInMeeting = true;
      const title = this.extractMeetingTitle();
      console.log("[Mina Meet] Reuniao detectada:", title);
      this.onStart(title);
    } else if (!inCall && this.isInMeeting) {
      this.isInMeeting = false;
      console.log("[Mina Meet] Reuniao encerrada");
      this.onEnd();
    }
  }

  private isUserInCall(): boolean {
    for (const selector of MeetingDetector.IN_CALL_SELECTORS) {
      if (document.querySelector(selector)) return true;
    }
    return false;
  }

  /** Extrai o titulo da reuniao do DOM ou da URL */
  extractMeetingTitle(): string {
    // Tentar pelo titulo da aba
    const pageTitle = document.title;
    if (pageTitle && !pageTitle.includes("Google Meet")) {
      // Formato tipico: "Nome da Reuniao - Google Meet"
      const cleaned = pageTitle.replace(/\s*[-–—]\s*Google Meet$/i, "").trim();
      if (cleaned) return cleaned;
    }

    // Tentar pelo elemento de titulo dentro do Meet
    const titleSelectors = [
      '[data-meeting-title]',
      '[data-tooltip*="info" i] + span',
      'div[jscontroller] > div > span',
    ];

    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 2 && text.length < 200) return text;
    }

    // Fallback: usar o codigo da reuniao da URL
    const meetCode = this.extractMeetId();
    return `Reuniao Meet ${meetCode}`;
  }

  /** Extrai o ID da reuniao da URL */
  extractMeetId(): string {
    const match = window.location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
    return match ? match[1] : window.location.pathname.replace("/", "");
  }

  /** Lista participantes visiveis na tela */
  extractParticipants(): string[] {
    const participants = new Set<string>();

    // Nomes exibidos nos tiles de video
    const nameSelectors = [
      '[data-participant-id] [data-self-name]',
      '[data-participant-id] .zWGUib',
      'div[data-requested-participant-id] .XEazBc',
    ];

    for (const sel of nameSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const name = el.textContent?.trim();
        if (name) participants.add(name);
      });
    }

    return Array.from(participants);
  }
}
