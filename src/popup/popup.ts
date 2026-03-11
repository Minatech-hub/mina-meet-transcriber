import { getConfig, getState, getCurrentMeeting } from "@/lib/storage";
import { MeetingData } from "@/lib/types";

interface MeetingSummary {
  summary: string;
  action_items: { title: string; assignee?: string; type?: string; deadline?: string }[];
  decisions: { decision: string; context?: string }[];
  key_topics: string[];
  generatedAt: string;
}

async function init() {
  const config = await getConfig();

  if (!config.apiKey || !config.clientId) {
    document.getElementById("no-config")!.style.display = "block";
    document.getElementById("main-content")!.style.display = "none";

    document.getElementById("open-options")?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  document.getElementById("client-name")!.textContent = config.clientName || config.clientId;

  await updateUI();
  setInterval(updateUI, 2000);

  // Botao enviar
  document.getElementById("btn-send")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-send") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Enviando...";
    const response = await chrome.runtime.sendMessage({ type: "SEND_NOW" });
    btn.textContent = response?.success ? "Enviado!" : `Erro: ${response?.error || "desconhecido"}`;
    setTimeout(() => { btn.textContent = "Enviar Agora"; btn.disabled = false; }, 2000);
  });

  // Botao configuracoes
  document.getElementById("btn-options")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.getAttribute("data-tab");
      document.getElementById(`tab-${target}`)?.classList.add("active");
    });
  });

  // Copiar transcricao
  document.getElementById("btn-copy-transcript")?.addEventListener("click", () => copyTranscript());

  // Baixar transcricao
  document.getElementById("btn-download-transcript")?.addEventListener("click", () => downloadTranscript());

  // Gerar resumo
  document.getElementById("btn-generate-summary")?.addEventListener("click", () => generateSummary());

  // Copiar resumo
  document.getElementById("btn-copy-summary")?.addEventListener("click", () => copySummary());

  // Baixar resumo
  document.getElementById("btn-download-summary")?.addEventListener("click", () => downloadSummary());

  // Limpar
  document.getElementById("btn-clear")?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_LAST_MEETING" });
    document.getElementById("last-meeting-section")!.style.display = "none";
    document.getElementById("live-section")!.style.display = "block";
  });
}

let lastMeetingCache: MeetingData | null = null;
let lastSummaryCache: MeetingSummary | null = null;

async function updateUI() {
  const state = await getState();
  const meeting = await getCurrentMeeting();

  const statusDot = document.getElementById("status-dot")!;
  const statusLabel = document.getElementById("status-label")!;
  const meetingTitle = document.getElementById("meeting-title")!;
  const entriesCount = document.getElementById("entries-count")!;
  const participantsCount = document.getElementById("participants-count")!;
  const durationDisplay = document.getElementById("duration-display")!;
  const btnSend = document.getElementById("btn-send")!;
  const syncStatus = document.getElementById("sync-status")!;
  const liveSection = document.getElementById("live-section")!;
  const lastSection = document.getElementById("last-meeting-section")!;

  if (state.isRecording && meeting) {
    liveSection.style.display = "block";
    lastSection.style.display = "none";

    statusDot.className = "status-dot active";
    statusLabel.textContent = "Gravando";
    meetingTitle.textContent = meeting.title;
    entriesCount.textContent = String(meeting.entries.length);
    participantsCount.textContent = String(meeting.participants.length);
    btnSend.style.display = "flex";

    // Calcular duracao em tempo real
    const elapsed = Math.floor((Date.now() - new Date(meeting.startedAt).getTime()) / 1000);
    durationDisplay.textContent = formatDuration(elapsed);
  } else {
    // Verificar se ha reuniao finalizada
    const lastMeeting = await chrome.runtime.sendMessage({ type: "GET_LAST_MEETING" }) as MeetingData | null;

    if (lastMeeting && lastMeeting.entries && lastMeeting.entries.length > 0) {
      lastMeetingCache = lastMeeting;
      liveSection.style.display = "none";
      lastSection.style.display = "block";
      renderLastMeeting(lastMeeting);

      // Verificar se ja tem resumo
      const summary = await chrome.runtime.sendMessage({ type: "GET_LAST_SUMMARY" }) as MeetingSummary | null;
      if (summary) {
        lastSummaryCache = summary;
        renderSummary(summary);
      }
    } else {
      liveSection.style.display = "block";
      lastSection.style.display = "none";

      statusDot.className = "status-dot inactive";
      statusLabel.textContent = "Inativo";
      meetingTitle.textContent = "Aguardando reuniao no Google Meet...";
      entriesCount.textContent = "0";
      participantsCount.textContent = "0";
      durationDisplay.textContent = "--";
      btnSend.style.display = "none";
    }
  }

  // Sync status
  switch (state.lastSyncStatus) {
    case "sending": syncStatus.textContent = "Enviando transcricao..."; break;
    case "success": syncStatus.textContent = "Transcricao salva na plataforma"; break;
    case "error": syncStatus.textContent = `Erro: ${state.lastError || "desconhecido"}`; break;
    default: syncStatus.textContent = "";
  }
}

function renderLastMeeting(meeting: MeetingData) {
  document.getElementById("last-meeting-title")!.textContent = meeting.title;
  document.getElementById("last-entries-count")!.textContent = String(meeting.entries.length);
  document.getElementById("last-participants-count")!.textContent = String(meeting.participants.length);
  document.getElementById("last-duration")!.textContent = formatDuration(meeting.durationSeconds || 0);

  // Renderizar transcricao
  const list = document.getElementById("transcript-list")!;
  if (meeting.entries.length === 0) {
    list.innerHTML = '<div class="empty-state">Nenhuma fala capturada</div>';
    return;
  }

  list.innerHTML = meeting.entries.map((entry) => `
    <div class="transcript-entry">
      <span class="transcript-speaker">${escapeHtml(entry.speaker)}</span>
      <span class="transcript-time">${formatTimestamp(entry.timestamp)}</span>
      <div class="transcript-text">${escapeHtml(entry.text)}</div>
    </div>
  `).join("");
}

function renderSummary(summary: MeetingSummary) {
  document.getElementById("summary-empty")!.style.display = "none";
  document.getElementById("summary-loading")!.style.display = "none";
  document.getElementById("summary-content")!.style.display = "block";

  // Resumo executivo
  document.getElementById("summary-text")!.textContent = summary.summary || "Sem resumo disponivel";

  // Topicos
  if (summary.key_topics && summary.key_topics.length > 0) {
    document.getElementById("summary-topics")!.style.display = "block";
    document.getElementById("topics-list")!.innerHTML = summary.key_topics
      .map((t) => `<span class="topic-tag">${escapeHtml(t)}</span>`)
      .join("");
  }

  // Itens de acao
  if (summary.action_items && summary.action_items.length > 0) {
    document.getElementById("summary-actions")!.style.display = "block";
    document.getElementById("actions-list")!.innerHTML = summary.action_items
      .map((item) => `
        <div class="action-item">
          <div class="action-checkbox"></div>
          <div>
            <div class="action-title">${escapeHtml(item.title)}</div>
            ${item.assignee ? `<div class="action-assignee">${escapeHtml(item.assignee)}</div>` : ""}
          </div>
        </div>
      `).join("");
  }

  // Decisoes
  if (summary.decisions && summary.decisions.length > 0) {
    document.getElementById("summary-decisions")!.style.display = "block";
    document.getElementById("decisions-list")!.innerHTML = summary.decisions
      .map((d) => `
        <div class="decision-item">
          <strong>${escapeHtml(d.decision)}</strong>
          ${d.context ? `<div style="color:var(--text-muted);font-size:11px;margin-top:3px;">${escapeHtml(d.context)}</div>` : ""}
        </div>
      `).join("");
  }
}

async function generateSummary() {
  const btn = document.getElementById("btn-generate-summary") as HTMLButtonElement;
  btn.disabled = true;

  document.getElementById("summary-empty")!.style.display = "none";
  document.getElementById("summary-loading")!.style.display = "block";

  try {
    const result = await chrome.runtime.sendMessage({ type: "GENERATE_SUMMARY" });

    if (result?.success) {
      const summary = await chrome.runtime.sendMessage({ type: "GET_LAST_SUMMARY" }) as MeetingSummary;
      if (summary) {
        lastSummaryCache = summary;
        renderSummary(summary);
      }
    } else {
      document.getElementById("summary-loading")!.style.display = "none";
      document.getElementById("summary-empty")!.style.display = "block";
      btn.disabled = false;
      btn.textContent = `Erro: ${result?.error || "tente novamente"}`;
      setTimeout(() => { btn.innerHTML = "&#10024; Gerar Resumo com IA"; }, 3000);
    }
  } catch {
    document.getElementById("summary-loading")!.style.display = "none";
    document.getElementById("summary-empty")!.style.display = "block";
    btn.disabled = false;
  }
}

function getTranscriptText(): string {
  if (!lastMeetingCache) return "";
  const meeting = lastMeetingCache;

  const header = [
    `TRANSCRICAO: ${meeting.title}`,
    `Data: ${new Date(meeting.startedAt).toLocaleDateString("pt-BR")} ${new Date(meeting.startedAt).toLocaleTimeString("pt-BR")}`,
    `Duracao: ${formatDuration(meeting.durationSeconds || 0)}`,
    `Participantes: ${meeting.participants.join(", ") || "N/A"}`,
    `Total de falas: ${meeting.entries.length}`,
    "",
    "=".repeat(60),
    "",
  ].join("\n");

  const body = meeting.entries
    .map((e) => `[${formatTimestamp(e.timestamp)}] ${e.speaker}: ${e.text}`)
    .join("\n");

  return header + body;
}

function getSummaryMarkdown(): string {
  if (!lastSummaryCache || !lastMeetingCache) return "";
  const s = lastSummaryCache;
  const m = lastMeetingCache;

  const lines = [
    `# ${m.title}`,
    "",
    `**Data:** ${new Date(m.startedAt).toLocaleDateString("pt-BR")}`,
    `**Duracao:** ${formatDuration(m.durationSeconds || 0)}`,
    `**Participantes:** ${m.participants.join(", ") || "N/A"}`,
    "",
  ];

  if (s.key_topics?.length) {
    lines.push(`## Topicos`, "", s.key_topics.map((t) => `- ${t}`).join("\n"), "");
  }

  lines.push(`## Resumo Executivo`, "", s.summary || "N/A", "");

  if (s.action_items?.length) {
    lines.push(`## Itens de Acao`, "");
    s.action_items.forEach((item, i) => {
      lines.push(`${i + 1}. **${item.title}**${item.assignee ? ` — ${item.assignee}` : ""}`);
    });
    lines.push("");
  }

  if (s.decisions?.length) {
    lines.push(`## Decisoes`, "");
    s.decisions.forEach((d) => {
      lines.push(`- **${d.decision}**${d.context ? ` (${d.context})` : ""}`);
    });
    lines.push("");
  }

  lines.push("---", "*Gerado por Mina Meet Transcriber + Joyce IA*");
  return lines.join("\n");
}

function copyTranscript() {
  const text = getTranscriptText();
  navigator.clipboard.writeText(text);
  flashButton("btn-copy-transcript", "Copiado!");
}

function downloadTranscript() {
  const text = getTranscriptText();
  const title = lastMeetingCache?.title?.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_") || "transcricao";
  downloadFile(`${title}.txt`, text, "text/plain");
  flashButton("btn-download-transcript", "Baixado!");
}

function copySummary() {
  const text = getSummaryMarkdown();
  navigator.clipboard.writeText(text);
  flashButton("btn-copy-summary", "Copiado!");
}

function downloadSummary() {
  const text = getSummaryMarkdown();
  const title = lastMeetingCache?.title?.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_") || "resumo";
  downloadFile(`${title}_resumo.md`, text, "text/markdown");
  flashButton("btn-download-summary", "Baixado!");
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function flashButton(btnId: string, msg: string) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const original = btn.innerHTML;
  btn.textContent = msg;
  btn.classList.add("active");
  setTimeout(() => { btn.innerHTML = original; btn.classList.remove("active"); }, 1500);
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

init();
