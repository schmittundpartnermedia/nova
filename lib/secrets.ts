const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{8,}/g,
  /OPENAI_API_KEY\s*[:=]\s*\S+/gi,
  /ANTHROPIC_API_KEY\s*[:=]\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}

export function looksLikeSecret(text: string): boolean {
  return /sk-[a-zA-Z0-9_-]{8,}/.test(text) || /API_KEY\s*[:=]/i.test(text);
}

export function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unbekannter Fehler";
  const safe = redactSecrets(raw);
  if (/api key|unauthorized|401|invalid_api_key/i.test(safe)) {
    return "Der KI-Anbieter hat die Anfrage abgelehnt. Der Schlüssel wird nicht angezeigt.";
  }
  if (/timeout|econnrefused|enotfound|network|fetch/i.test(safe)) {
    return "Der KI-Anbieter ist gerade nicht erreichbar.";
  }
  return "Die KI-Anfrage ist fehlgeschlagen.";
}

export function hasOpenAIApiKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key.trim().length > 0);
}
