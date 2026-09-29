/**
 * Füllt Mail-Vorlagen mit Platzhaltern wie {{anrede}}, {{firma}}, {{ansprechpartner}}.
 * Kein Platzhalter wird still ersetzt: fehlende Werte werden gemeldet.
 */
const PLATZHALTER = /\{\{\s*([a-zA-Z0-9äöüÄÖÜß_]+)\s*\}\}/g;

export function platzhalterIn(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(PLATZHALTER), (match) => match[1]!.toLowerCase())));
}

export function fillMailTemplate(
  template: string,
  werte: Record<string, string>,
): { text: string; fehlend: string[] } {
  const normiert = Object.fromEntries(
    Object.entries(werte).map(([key, value]) => [key.trim().toLowerCase(), String(value ?? "").trim()]),
  );
  const fehlend = platzhalterIn(template).filter((key) => !normiert[key]);
  const text = template.replace(PLATZHALTER, (whole, key: string) => normiert[key.toLowerCase()] || whole);
  return { text, fehlend };
}
