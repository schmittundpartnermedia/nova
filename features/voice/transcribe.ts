export async function transcribeUtterance(blob: Blob): Promise<string> {
  const ext = extensionFor(blob.type);
  const form = new FormData();
  form.append("file", blob, `utterance.${ext}`);
  const response = await fetch("/api/nova/transcribe", {
    method: "POST",
    body: form,
  });
  const data = (await response.json().catch(() => null)) as { ok?: boolean; text?: string } | null;
  if (!response.ok || !data?.ok) return "";
  return typeof data.text === "string" ? data.text.trim() : "";
}

function extensionFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}
