import { getConfig } from "./storage";
import { MeetingData, SaveResponse, SummarizeResponse, JoyceCommand, JoyceResponse } from "./types";

async function getHeaders(): Promise<Record<string, string>> {
  const config = await getConfig();
  return {
    "Content-Type": "application/json",
    "x-meet-api-key": config.apiKey,
  };
}

async function getBaseUrl(): Promise<string> {
  const config = await getConfig();
  return config.apiUrl;
}

/** Envia a transcricao completa para o backend */
export async function saveTranscription(meeting: MeetingData): Promise<SaveResponse> {
  const baseUrl = await getBaseUrl();
  const headers = await getHeaders();
  const config = await getConfig();

  const response = await fetch(`${baseUrl}/meet-transcriber-save`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      client_id: config.clientId,
      title: meeting.title,
      meet_id: meeting.meetId,
      meet_url: meeting.meetUrl,
      started_at: meeting.startedAt,
      ended_at: meeting.endedAt,
      duration_seconds: meeting.durationSeconds,
      participants: meeting.participants,
      transcript: meeting.entries,
      raw_text: meeting.entries.map((e) => `[${e.speaker}]: ${e.text}`).join("\n"),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `HTTP ${response.status}: ${error}` };
  }

  return response.json();
}

/** Solicita sumarizacao de uma transcricao ja salva */
export async function requestSummarize(transcriptionId: string): Promise<SummarizeResponse> {
  const baseUrl = await getBaseUrl();
  const headers = await getHeaders();

  const response = await fetch(`${baseUrl}/meet-transcriber-summarize`, {
    method: "POST",
    headers,
    body: JSON.stringify({ transcription_id: transcriptionId }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `HTTP ${response.status}: ${error}` };
  }

  return response.json();
}

/** Envia um comando para a Joyce IA processar */
export async function sendJoyceCommand(
  command: JoyceCommand,
  meetingTitle: string
): Promise<JoyceResponse> {
  const baseUrl = await getBaseUrl();
  const headers = await getHeaders();
  const config = await getConfig();

  try {
    const response = await fetch(`${baseUrl}/meet-joyce-ai`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        client_id: config.clientId,
        speaker: command.speaker,
        command: command.command,
        recent_context: command.recentContext,
        meeting_title: meetingTitle,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        textResponse: "Desculpa, nao consegui processar. Tenta de novo?",
        error: `HTTP ${response.status}: ${error}`,
      };
    }

    return response.json();
  } catch (err: unknown) {
    return {
      success: false,
      textResponse: "Estou com problemas de conexao. Tenta de novo daqui a pouco?",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
