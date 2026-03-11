/** Remove legendas duplicadas que o Meet pode emitir */
export function deduplicateEntries<T extends { speaker: string; text: string }>(
  entries: T[]
): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.speaker}:${entry.text.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Limpa texto de legendas (remove espacos extras, etc.) */
export function cleanCaptionText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\[.*?\]/g, "") // remover marcadores como [inaudível]
    .trim();
}

/** Formata duracao em segundos para "Xh Ym" */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Formata timestamp relativo ao inicio da reuniao */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
