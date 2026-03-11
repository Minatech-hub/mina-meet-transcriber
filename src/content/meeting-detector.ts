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
  // Multiplas estrategias para cobrir diferentes versoes/idiomas do Meet
  private static IN_CALL_SELECTORS = [
    // Botao de desligar (vermelho) — principal indicador de chamada ativa
    'button[aria-label*="desligar" i]',
    'button[aria-label*="leave" i]',
    'button[aria-label*="hang up" i]',
    'button[aria-label*="sair da chamada" i]',
    'button[aria-label*="Leave call" i]',
    'button[data-tooltip*="desligar" i]',
    'button[data-tooltip*="Leave" i]',
    'button[data-tooltip*="Sair" i]',
    // Botao vermelho de encerrar (icone phone) — classe especifica do Meet
    'button[jsname="CQylAd"]',
    // Controles de chamada (mic/camera) indicam que esta em call
    'div[jscontroller][jsname] button[aria-label*="microfone" i]',
    'div[jscontroller][jsname] button[aria-label*="microphone" i]',
    'div[jscontroller][jsname] button[aria-label*="câmera" i]',
    'div[jscontroller][jsname] button[aria-label*="camera" i]',
    // Barra inferior de controles do Meet
    '[data-call-active="true"]',
    // Fallback: area de participantes em video (tiles)
    'div[data-participant-id]',
    'div[data-requested-participant-id]',
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
      const el = document.querySelector(selector);
      if (el) {
        if (!this.isInMeeting) {
          console.log("[Mina Meet] Chamada detectada via seletor:", selector);
        }
        return true;
      }
    }

    // Fallback heuristico: se estamos numa URL de reuniao e o body tem
    // muitos elementos interativos (botoes, videos), provavelmente esta em call
    if (window.location.pathname.match(/\/[a-z]{3}-[a-z]{4}-[a-z]{3}/)) {
      // Verificar se existem elementos de video/stream renderizados
      const hasVideo = document.querySelectorAll("video").length > 0;
      const hasCallUI = document.querySelectorAll('button[aria-label]').length >= 3;
      if (hasVideo && hasCallUI) {
        if (!this.isInMeeting) {
          console.log("[Mina Meet] Chamada detectada via fallback (video + botoes)");
        }
        return true;
      }
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
