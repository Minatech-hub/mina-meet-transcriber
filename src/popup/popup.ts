import { getConfig, getState, getCurrentMeeting } from "@/lib/storage";
import { ExtensionState } from "@/lib/types";

async function init() {
  const config = await getConfig();

  // Verificar se esta configurado
  if (!config.apiKey || !config.clientId) {
    document.getElementById("no-config")!.style.display = "block";
    document.getElementById("main-content")!.style.display = "none";

    document.getElementById("open-options")?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  // Mostrar nome do cliente
  document.getElementById("client-name")!.textContent = config.clientName || config.clientId;

  // Atualizar estado
  await updateUI();

  // Poll estado a cada 2s
  setInterval(updateUI, 2000);

  // Botao enviar
  document.getElementById("btn-send")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-send") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Enviando...";

    const response = await chrome.runtime.sendMessage({ type: "SEND_NOW" });

    if (response?.success) {
      btn.textContent = "Enviado!";
      setTimeout(() => {
        btn.textContent = "Enviar Agora";
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = `Erro: ${response?.error || "desconhecido"}`;
      btn.disabled = false;
    }
  });

  // Botao configuracoes
  document.getElementById("btn-options")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

async function updateUI() {
  const state = await getState();
  const meeting = await getCurrentMeeting();

  const statusDot = document.getElementById("status-dot")!;
  const statusLabel = document.getElementById("status-label")!;
  const meetingTitle = document.getElementById("meeting-title")!;
  const entriesCount = document.getElementById("entries-count")!;
  const participantsCount = document.getElementById("participants-count")!;
  const btnSend = document.getElementById("btn-send")!;
  const syncStatus = document.getElementById("sync-status")!;

  if (state.isRecording && meeting) {
    statusDot.className = "status-dot active";
    statusLabel.textContent = "Gravando";
    meetingTitle.textContent = meeting.title;
    entriesCount.textContent = String(meeting.entries.length);
    participantsCount.textContent = String(meeting.participants.length);
    btnSend.style.display = "flex";
  } else {
    statusDot.className = "status-dot inactive";
    statusLabel.textContent = "Inativo";
    meetingTitle.textContent = "Aguardando reuniao no Google Meet...";
    entriesCount.textContent = "0";
    participantsCount.textContent = "0";
    btnSend.style.display = "none";
  }

  // Sync status
  switch (state.lastSyncStatus) {
    case "sending":
      syncStatus.textContent = "Enviando transcricao...";
      break;
    case "success":
      syncStatus.textContent = "Ultima transcricao enviada com sucesso";
      break;
    case "error":
      syncStatus.textContent = `Erro: ${state.lastError || "desconhecido"}`;
      break;
    default:
      syncStatus.textContent = "";
  }
}

init();
