import { prisma } from "@/lib/prisma";
import type { Lead } from "@prisma/client";

/**
 * Versteht einen Betrieb aus seiner Website (Rohtexte des Lead-Scanners): sauberer Firmenname, Gewerk und Suchwort
 * für den rankPilot-Check, Leistungen in eigenen Worten und der passende Ansprechpartner aus Impressum/Kontakt.
 * Das Sprachmodell interpretiert, erfindet aber nichts: Ein Ansprechpartner zählt nur, wenn sein Nachname wörtlich
 * in Impressum, Kontakt- oder „Über uns“-Seite steht. Ohne sicheren Ansprechpartner: „Hallo zusammen“.
 */

export type Ansprechpartner = { anrede: "Herr" | "Frau"; vorname: string | null; nachname: string; rolle: string };
export type Profil = {
  firmenname: string;
  gewerk: string;
  suchwort: string;
  leistungen: string[];
  ansprechpartner: Ansprechpartner | null;
  hinweis: string | null;
};
export type LeadTexte = {
  kategorien?: string[];
  texte?: { start?: string; impressum?: string; kontakt?: string; ueber?: string };
  alleEmails?: string[];
  inhaberName?: string | null;
  ansprechpartner?: string | null;
};

/** Was die Auswertung braucht: eine strukturierte Modellabfrage (OpenAIProvider.strukturiert; Tests setzen eine eigene ein). */
export type Auswerter = { strukturiert<T>(input: { name: string; anweisung: string; eingabe: string; schema: Record<string, unknown> }): Promise<T> };

const SCHEMA = {
  type: "object",
  properties: {
    firmenname: { type: "string", description: "Name, wie der Betrieb sich selbst nennt, korrekt geschrieben (z. B. „Schreinerei Klenk“), ohne Ort und ohne Rechtsform-Zusätze wie GmbH." },
    gewerk: { type: "string", description: "Berufsbezeichnung im Singular, wie man den Betrieb nennt (z. B. „Schreiner“, „Zimmerer“, „Raumausstatter“)." },
    suchwort: { type: "string", description: "Wonach Kunden bei Google oder in KI-Suchen suchen, ohne Ort (z. B. „Schreiner“, „Treppenbau“). Ein bis zwei Wörter." },
    leistungen: { type: "array", items: { type: "string" }, description: "Höchstens fünf Leistungen in eigenen kurzen Worten (z. B. „Möbel nach Maß“, „Innenausbau“)." },
    ansprechpartner: {
      anyOf: [
        {
          type: "object",
          properties: {
            anrede: { type: "string", enum: ["Herr", "Frau"] },
            vorname: { type: ["string", "null"] },
            nachname: { type: "string" },
            rolle: { type: "string", description: "z. B. Inhaber, Geschäftsführerin, Marketing" },
          },
          required: ["anrede", "vorname", "nachname", "rolle"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    hinweis: { type: ["string", "null"], description: "Kurz, falls etwas auffällt (z. B. „kein Impressum gefunden“, „Website gehört zu einem Verzeichnis“)." },
  },
  required: ["firmenname", "gewerk", "suchwort", "leistungen", "ansprechpartner", "hinweis"],
  additionalProperties: false,
};

const ANWEISUNG = [
  "Du liest die Website eines lokalen Betriebs und gibst nüchterne, verlässliche Daten zurück. Deutsch.",
  "Interpretiere statt zu kopieren: Steht dort „Schreinerei & Innenausbau“, ist das Gewerk „Schreiner“ und das Suchwort „Schreiner“.",
  "Ansprechpartner: nur eine Person, deren Name im Impressum, auf der Kontakt- oder der Über-uns-Seite steht.",
  "Gibt es eine ausdrücklich genannte Person für Marketing, Vertrieb oder Kundenanfragen, nimm sie; sonst Inhaber/in bzw. Geschäftsführer/in; bei mehreren die zuerst genannte.",
  "Keine Datenschutzbeauftragten, Webdesigner, Agenturen, Hosting- oder Verzeichnisbetreiber.",
  "Anrede Herr/Frau nur, wenn sie dort steht oder der Vorname eindeutig ist; sonst ansprechpartner = null. Lieber null als raten.",
  "Erfinde nichts. Fehlt etwas, nimm das Naheliegende aus Google-Name und -Kategorien und schreib es in hinweis.",
].join("\n");

function eingabe(lead: Lead, t: LeadTexte): string {
  const teile = [
    `Google-Name: ${lead.firma}`,
    lead.ort ? `Ort: ${lead.ort}` : "",
    lead.branche ? `Gesucht wurde nach: ${lead.branche}` : "",
    t.kategorien?.length ? `Google-Kategorien: ${t.kategorien.join(", ")}` : "",
    lead.website ? `Website: ${lead.website}` : "",
    t.texte?.start ? `--- Startseite ---\n${t.texte.start}` : "--- Startseite: nicht gelesen ---",
    t.texte?.impressum ? `--- Impressum ---\n${t.texte.impressum}` : "--- Impressum: nicht gefunden ---",
    t.texte?.kontakt ? `--- Kontakt ---\n${t.texte.kontakt}` : "",
    t.texte?.ueber ? `--- Über uns ---\n${t.texte.ueber}` : "",
  ];
  return teile.filter(Boolean).join("\n");
}

/** Prüft die Antwort gegen die Quelltexte: Ein Ansprechpartner, dessen Nachname dort nicht steht, wird verworfen. */
export function pruefeProfil(roh: Profil, lead: Lead, t: LeadTexte): Profil {
  const quellen = [t.texte?.impressum, t.texte?.kontakt, t.texte?.ueber].filter(Boolean).join("\n").toLowerCase();
  const person = roh.ansprechpartner;
  const personOk = Boolean(person?.nachname.trim() && quellen.includes(person.nachname.trim().toLowerCase()));
  return {
    firmenname: roh.firmenname.trim() || lead.firma,
    gewerk: roh.gewerk.trim() || lead.branche || "",
    suchwort: roh.suchwort.trim() || roh.gewerk.trim() || lead.branche || "",
    leistungen: roh.leistungen.map((l) => l.trim()).filter(Boolean).slice(0, 5),
    ansprechpartner: personOk && person ? { ...person, nachname: person.nachname.trim(), vorname: person.vorname?.trim() || null } : null,
    hinweis: [roh.hinweis, person && !personOk ? `Ansprechpartner „${person.nachname}“ nicht in den Quelltexten gefunden – verworfen` : null]
      .filter(Boolean)
      .join("; ") || null,
  };
}

/** „Hallo Herr Kanzleiter“ bzw. „Hallo zusammen“ (Komma setzt die Vorlage). */
export function anredeAus(profil: Profil | null): string {
  const p = profil?.ansprechpartner;
  return p ? `Hallo ${p.anrede} ${p.nachname}` : "Hallo zusammen";
}

export function leseTexte(lead: Lead): LeadTexte {
  try {
    return lead.texte ? (JSON.parse(lead.texte) as LeadTexte) : {};
  } catch {
    return {};
  }
}

export function leseProfil(lead: Lead): Profil | null {
  try {
    return lead.profil ? (JSON.parse(lead.profil) as Profil) : null;
  } catch {
    return null;
  }
}

/** Versteht den Betrieb (einmal; danach aus der Datenbank) und speichert das Profil. */
export async function verstehe(lead: Lead, auswerter: Auswerter): Promise<Profil> {
  const vorhanden = leseProfil(lead);
  if (vorhanden) return vorhanden;
  const t = leseTexte(lead);
  const roh = await auswerter.strukturiert<Profil>({ name: "betriebsprofil", anweisung: ANWEISUNG, eingabe: eingabe(lead, t), schema: SCHEMA });
  const profil = pruefeProfil(roh, lead, t);
  await prisma.lead.update({ where: { id: lead.id }, data: { profil: JSON.stringify(profil), profilAt: new Date(), anrede: anredeAus(profil) } });
  return profil;
}
