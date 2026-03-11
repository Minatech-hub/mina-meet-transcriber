/** Uma fala individual capturada das legendas */
export interface CaptionEntry {
  timestamp: number; // ms desde o inicio da reuniao
  speaker: string;
  text: string;
  capturedAt: string; // ISO timestamp
}

/** Dados de uma reuniao completa */
export interface MeetingData {
  meetId: string; // ID unico da reuniao (extraido da URL)
  title: string;
  startedAt: string; // ISO timestamp
  endedAt?: string;
  durationSeconds?: number;
  participants: string[];
  entries: CaptionEntry[];
  meetUrl: string;
}

/** Configuracao da extensao */
export interface ExtensionConfig {
  apiUrl: string; // URL da Edge Function
  apiKey: string; // Chave de autenticacao
  clientId: string; // ID do cliente vinculado
  clientName: string; // Nome do cliente (para exibicao)
  autoEnableCaptions: boolean;
  language: "pt-BR" | "en" | "es";
}

/** Estado atual da extensao (mantido no service worker) */
export interface ExtensionState {
  isRecording: boolean;
  currentMeeting: MeetingData | null;
  lastSyncStatus: "idle" | "sending" | "success" | "error";
  lastError?: string;
  entriesCount: number;
}

/** Mensagens entre content script e service worker */
export type Message =
  | { type: "MEETING_STARTED"; data: { meetId: string; title: string; meetUrl: string } }
  | { type: "MEETING_ENDED" }
  | { type: "CAPTION_CAPTURED"; data: CaptionEntry }
  | { type: "PARTICIPANT_DETECTED"; data: { name: string } }
  | { type: "GET_STATE" }
  | { type: "STATE_UPDATE"; data: ExtensionState }
  | { type: "SEND_NOW" }
  | { type: "TOGGLE_RECORDING"; data: { enabled: boolean } }
  | { type: "JOYCE_COMMAND"; data: JoyceCommand }
  | { type: "JOYCE_RESPONSE"; data: JoyceResponse }
  | { type: "GET_LAST_MEETING" }
  | { type: "GET_LAST_SUMMARY" }
  | { type: "GENERATE_SUMMARY" }
  | { type: "CLEAR_LAST_MEETING" }
  | { type: "JOYCE_MANUAL_COMMAND"; data: { command: string } }
  | { type: "GET_DIAGNOSTICS" };

/** Comando detectado para a Joyce durante a reuniao */
export interface JoyceCommand {
  speaker: string;
  command: string; // texto completo apos "Joyce"
  recentContext: CaptionEntry[]; // ultimas N falas para contexto
}

/** Resposta da Joyce ao processar um comando */
export interface JoyceResponse {
  success: boolean;
  textResponse: string; // resposta em texto
  audioUrl?: string; // URL do audio gerado (base64 data URL)
  action?: JoyceAction;
  error?: string;
}

/** Acao executada pela Joyce */
export interface JoyceAction {
  type: "task_created" | "question_answered" | "summary_requested" | "note_created";
  details: Record<string, unknown>;
}

/** Resposta da Edge Function ao salvar */
export interface SaveResponse {
  success: boolean;
  transcription_id?: string;
  message?: string;
  error?: string;
}

/** Resposta da Edge Function ao sumarizar */
export interface SummarizeResponse {
  success: boolean;
  summary?: string;
  action_items?: ActionItem[];
  decisions?: Decision[];
  error?: string;
}

export interface ActionItem {
  title: string;
  assignee?: string;
  type: string;
  deadline?: string;
  reason?: string;
}

export interface Decision {
  decision: string;
  context?: string;
}
