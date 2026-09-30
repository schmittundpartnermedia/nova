/**
 * Füllt Mail-Vorlagen mit Platzhaltern wie {{anrede}}, {{firma}}, {{ansprechpartner}}.
 * Kein Platzhalter wird still ersetzt: fehlende Werte werden gemeldet.
 * Ausnahme mit Absicht: Abschnitt {{#name}} … {{/name}} erscheint nur, wenn „name“ einen Wert hat;
 * sonst fällt er samt Inhalt weg (für optionale Sätze wie die Feststellung aus dem Scanner).
 */
const PLATZHALTER = /\{\{\s*([a-zA-Z0-9äöüÄÖÜß_]+)\s*\}\}/g;
const ABSCHNITT = /\{\{\s*#\s*([a-zA-Z0-9äöüÄÖÜß_]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\1\s*\}\}/g;

export function platzhalterIn(text: string): string[] {
  return Array.from(new Set(Array.from(text.replace(ABSCHNITT, "").matchAll(PLATZHALTER), (match) => match[1]!.toLowerCase())));
}

export function optionalePlatzhalterIn(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(ABSCHNITT), (match) => match[1]!.toLowerCase())));
}

export function fillMailTemplate(
  template: string,
  werte: Record<string, string>,
): { text: string; fehlend: string[] } {
  const normiert = Object.fromEntries(
    Object.entries(werte).map(([key, value]) => [key.trim().toLowerCase(), String(value ?? "").trim()]),
  );
  const fehlend = platzhalterIn(template).filter((key) => !normiert[key]);
  const text = template
    .replace(ABSCHNITT, (_whole, key: string, inhalt: string) => (normiert[key.toLowerCase()] ? inhalt : ""))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(PLATZHALTER, (whole, key: string) => normiert[key.toLowerCase()] || whole)
    .trim();
  return { text, fehlend };
}
