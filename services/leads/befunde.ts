import type { Lead } from "@prisma/client";
import type { CheckBericht } from "@/lib/rankpilot/persoenlicher-check";
import { gedankenstrichIn } from "@/lib/mail/stil";
import type { Auswerter, Profil } from "@/services/leads/profil";

/**
 * Aus dem echten Check-Bericht 1–2 Ergebnisse für Joachims Mail: in Sie-Form, ruhig und konkret,
 * nur was im Bericht steht. Kein Firmenname (Joachims Vorgabe: der Betrieb wird nur in der Anrede genannt),
 * keine Gedankenstriche. Sätze, die das nicht einhalten, fallen weg; bleibt nichts, wird nicht geschrieben.
 */

const SCHEMA = {
  type: "object",
  properties: {
    befunde: {
      type: "array",
      items: { type: "string" },
      description: "1 bis 2 Sätze, je eine konkrete Beobachtung aus dem Bericht.",
    },
  },
  required: ["befunde"],
  additionalProperties: false,
};

const ANWEISUNG = [
  "Du schreibst für Joachim Schmitt, Gründer von rankPilot, 1 bis 2 Sätze für eine persönliche Mail an einen lokalen Betrieb.",
  "Grundlage ist ausschließlich der beigefügte Bericht seines kostenlosen Sichtbarkeits-Checks. Nichts dazuerfinden, keine Zahlen, die nicht dort stehen.",
  "Wähle die 1–2 Punkte, die für den Betrieb am greifbarsten sind (z. B. ob er bei Google Maps oder in KI-Suchen für sein Gewerk in seinem Ort auftaucht, wie er im Vergleich zum Wettbewerb dasteht).",
  "Sie-Form, ruhig, konkret, kein Werbeton, keine Ausrufezeichen. Jeder Satz eigenständig verständlich.",
  "Nenne den Namen des Betriebs NICHT (er steht schon in der Anrede). „Ihr Betrieb“, „Sie“ ist richtig.",
  "Keine Gedankenstriche (– oder —). Einzahl/Mehrzahl korrekt („1 Bewertung“, „3 Bewertungen“).",
].join("\n");

/** Bericht auf das Wesentliche kürzen (Punch, größter Hebel, Bereiche, Abstände, Probleme, Suchanfrage). */
export function berichtsAuszug(bericht: CheckBericht): string {
  const r = (bericht.report ?? {}) as Record<string, unknown>;
  const v = (bericht.visibility ?? {}) as Record<string, unknown>;
  const auszug = {
    suche: v.displayQuery ?? v.measuredKeyword ?? null,
    ort: v.city ?? null,
    punch: r.punch ?? null,
    groessterHebel: r.biggestLever ?? null,
    bereiche: Array.isArray(r.areas)
      ? (r.areas as Array<Record<string, unknown>>).map((a) => ({ titel: a.title, ampel: a.tone, kurz: a.label, zusammenfassung: a.summary }))
      : [],
    abstaende: r.distances ?? [],
    probleme: r.problems ?? [],
    suchbegriffe: r.keywordCompare ?? null,
  };
  return JSON.stringify(auszug).slice(0, 6000);
}

export function pruefeBefunde(befunde: string[], namen: string[]): string[] {
  const verboten = namen.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3);
  return befunde
    .map((b) => b.trim().replace(/\s+/g, " "))
    .filter((b) => b.length >= 20 && b.length <= 300)
    .filter((b) => !gedankenstrichIn(b))
    .filter((b) => !verboten.some((n) => b.toLowerCase().includes(n)))
    .slice(0, 2);
}

export async function formuliereBefunde(input: { lead: Lead; profil: Profil; bericht: CheckBericht; auswerter: Auswerter }): Promise<string[]> {
  if (!input.bericht.report) return [];
  const eingabe = [
    `Gewerk: ${input.profil.gewerk}`,
    input.lead.ort ? `Ort: ${input.lead.ort}` : "",
    `Bericht (JSON): ${berichtsAuszug(input.bericht)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const roh = await input.auswerter.strukturiert<{ befunde: string[] }>({ name: "check_befunde", anweisung: ANWEISUNG, eingabe, schema: SCHEMA });
  // Firmenname (sauber und wie bei Google) darf nicht vorkommen.
  return pruefeBefunde(roh.befunde, [input.profil.firmenname, input.lead.firma]);
}
