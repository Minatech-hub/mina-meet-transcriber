import { ExtensionConfig, ExtensionState, MeetingData } from "./types";

const STORAGE_KEYS = {
  CONFIG: "mina_config",
  STATE: "mina_state",
  CURRENT_MEETING: "mina_current_meeting",
  LAST_MEETING: "mina_last_meeting",
  LAST_SUMMARY: "mina_last_summary",
} as const;

const DEFAULT_CONFIG: ExtensionConfig = {
  apiUrl: "https://gtekqkpmxbpgkelbyuul.supabase.co/functions/v1",
  apiKey: "",
  clientId: "",
  clientName: "",
  autoEnableCaptions: true,
  language: "pt-BR",
};

const DEFAULT_STATE: ExtensionState = {
  isRecording: false,
  currentMeeting: null,
  lastSyncStatus: "idle",
  entriesCount: 0,
};

export async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
  return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.CONFIG] };
}

export async function saveConfig(config: Partial<ExtensionConfig>): Promise<void> {
  const current = await getConfig();
  await chrome.storage.local.set({
    [STORAGE_KEYS.CONFIG]: { ...current, ...config },
  });
}

export async function getState(): Promise<ExtensionState> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATE);
  return { ...DEFAULT_STATE, ...result[STORAGE_KEYS.STATE] };
}

export async function saveState(state: Partial<ExtensionState>): Promise<void> {
  const current = await getState();
  await chrome.storage.local.set({
    [STORAGE_KEYS.STATE]: { ...current, ...state },
  });
}

export async function getCurrentMeeting(): Promise<MeetingData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CURRENT_MEETING);
  return result[STORAGE_KEYS.CURRENT_MEETING] || null;
}

export async function saveCurrentMeeting(meeting: MeetingData | null): Promise<void> {
  if (meeting) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CURRENT_MEETING]: meeting });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.CURRENT_MEETING);
  }
}

export async function getLastMeeting(): Promise<MeetingData | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_MEETING);
  return result[STORAGE_KEYS.LAST_MEETING] || null;
}

export async function saveLastMeeting(meeting: MeetingData | null): Promise<void> {
  if (meeting) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_MEETING]: meeting });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.LAST_MEETING);
  }
}

export interface MeetingSummary {
  summary: string;
  action_items: { title: string; assignee?: string; type?: string; deadline?: string }[];
  decisions: { decision: string; context?: string }[];
  key_topics: string[];
  generatedAt: string;
}

export async function getLastSummary(): Promise<MeetingSummary | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_SUMMARY);
  return result[STORAGE_KEYS.LAST_SUMMARY] || null;
}

export async function saveLastSummary(summary: MeetingSummary | null): Promise<void> {
  if (summary) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SUMMARY]: summary });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.LAST_SUMMARY);
  }
}
