import { getConfig, saveConfig } from "@/lib/storage";
import { ExtensionConfig } from "@/lib/types";

async function init() {
  const config = await getConfig();

  // Preencher campos
  (document.getElementById("api-url") as HTMLInputElement).value = config.apiUrl;
  (document.getElementById("api-key") as HTMLInputElement).value = config.apiKey;
  (document.getElementById("client-id") as HTMLInputElement).value = config.clientId;
  (document.getElementById("client-name") as HTMLInputElement).value = config.clientName;
  (document.getElementById("language") as HTMLSelectElement).value = config.language;
  (document.getElementById("auto-captions") as HTMLInputElement).checked = config.autoEnableCaptions;

  // Salvar
  document.getElementById("config-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handleSave();
  });

  // Testar conexao
  document.getElementById("btn-test")?.addEventListener("click", handleTest);
}

async function handleSave() {
  const config: Partial<ExtensionConfig> = {
    apiUrl: (document.getElementById("api-url") as HTMLInputElement).value.trim(),
    apiKey: (document.getElementById("api-key") as HTMLInputElement).value.trim(),
    clientId: (document.getElementById("client-id") as HTMLInputElement).value.trim(),
    clientName: (document.getElementById("client-name") as HTMLInputElement).value.trim(),
    language: (document.getElementById("language") as HTMLSelectElement).value as ExtensionConfig["language"],
    autoEnableCaptions: (document.getElementById("auto-captions") as HTMLInputElement).checked,
  };

  await saveConfig(config);

  const msg = document.getElementById("saved-msg")!;
  msg.classList.add("visible");
  setTimeout(() => msg.classList.remove("visible"), 2000);
}

async function handleTest() {
  const btn = document.getElementById("btn-test") as HTMLButtonElement;
  const originalText = btn.textContent;
  btn.textContent = "Testando...";
  btn.disabled = true;

  try {
    const apiUrl = (document.getElementById("api-url") as HTMLInputElement).value.trim();
    const apiKey = (document.getElementById("api-key") as HTMLInputElement).value.trim();

    const response = await fetch(`${apiUrl}/meet-transcriber-save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-meet-api-key": apiKey,
      },
      body: JSON.stringify({ action: "ping" }),
    });

    if (response.ok) {
      btn.textContent = "Conectado!";
      btn.style.borderColor = "#00d4aa";
      btn.style.color = "#00d4aa";
    } else {
      btn.textContent = `Erro ${response.status}`;
      btn.style.borderColor = "#ef4444";
      btn.style.color = "#ef4444";
    }
  } catch (err) {
    btn.textContent = "Falha na conexao";
    btn.style.borderColor = "#ef4444";
    btn.style.color = "#ef4444";
  }

  setTimeout(() => {
    btn.textContent = originalText;
    btn.disabled = false;
    btn.style.borderColor = "";
    btn.style.color = "";
  }, 3000);
}

init();
