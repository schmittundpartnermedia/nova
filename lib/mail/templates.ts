/**
 * Mail-Vorlagen mit Platzhaltern {{anrede}}, {{firma}}, {{vorname}}, {{projekt}}, {{rolle}}.
 * Vom Nutzer gepflegte Vorlagen liegen in der DB; ohne Vorlage gibt es einen neutralen Fallback
 * (kein fest verdrahteter Sponsoren-Text mehr im Communication-Agenten).
 */
export type TemplateVars = {
  anrede?: string;
  firma?: string;
  vorname?: string;
  nachname?: string;
  projekt?: string;
  rolle?: string;
};

export function fillMailTemplate(template: string, vars: TemplateVars): string {
  const anrede =
    vars.anrede?.trim() ||
    (vars.vorname ? `Guten Tag ${vars.vorname}` : "Guten Tag");
  const map: Record<string, string> = {
    anrede,
    firma: vars.firma?.trim() || "Ihnen",
    vorname: vars.vorname?.trim() || "",
    nachname: vars.nachname?.trim() || "",
    projekt: vars.projekt?.trim() || "unserem Vorhaben",
    rolle: vars.rolle?.trim() || "",
  };
  return template.replace(/\{\{\s*([a-zA-ZäöüÄÖÜß_]+)\s*\}\}/g, (_, key: string) => {
    const value = map[key.toLowerCase()];
    return value !== undefined ? value : "";
  });
}

export const DEFAULT_OUTREACH_TEMPLATE = `{{anrede}},

im Rahmen von {{projekt}} melde ich mich kurz bei {{firma}}.

Ich würde das gern knapp und konkret vorstellen – ohne langen Pitch.

Passt Ihnen ein kurzes Gespräch in den nächsten zwei Wochen?

Freundliche Grüße`;
