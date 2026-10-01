import { prisma } from "@/lib/prisma";
import { lesenGedaechtnis } from "@/lib/gedaechtnis/store";
import { leseVorlagen } from "@/lib/mail/vorlagen";
import { alleSignaturen } from "@/lib/mail/signaturen";
import { kontaktlistenNamen } from "@/lib/mail/kontaktlisten";
import { findMatchingPolicy } from "@/services/approvals";
import { leseEinstellungen } from "@/services/tagesbetrieb/einstellungen";
import { leseProjekte, ordnerOhneGit } from "@/lib/claude/projekte";
import type { NovaToolDefinition } from "@/services/tools/types";

/**
 * Selbstauskunft: Was NOVA kann, was gerade läuft und was ihr fehlt – aus dem echten Zustand
 * (Vorlagen, Freigaben, Listen, Einstellungen), nicht aus einer festen Behauptung.
 */

const FAEHIGKEITEN = [
  "mir Dinge merken (Firma, Kunden, Projekte) und im Gespräch darauf zurückgreifen",
  "Mails in Apple Mail lesen und zusammenfassen",
  "Antworten und neue Mails entwerfen – gesendet wird erst nach deinem Ja oder mit Dauerfreigabe",
  "Mail-Vorlagen mit Platzhaltern füllen (z. B. Sponsoren-Anschreiben)",
  "Kampagnen: eine Kontaktliste mit einer Vorlage im Abstand anschreiben und Antworten erkennen (auch wenn ein Kollege antwortet)",
  "Nachfass-Mail: wer nach einigen Tagen nicht antwortet, bekommt einmal eine kurze zweite Mail (Vorlage „<vorlage>-nachfass“)",
  "Absagen, unzustellbare Adressen und „bitte keine Mails“ selbst auf die Sperrliste setzen; Abwesenheitsnotizen erkennen",
  "Sponsoren, die du mir nennst, mit richtiger Anrede in eine Liste eintragen",
  "mit deinem Lead-Scanner ALLE Betriebe einer Branche im Umkreis um einen Ort finden (Gebietssuche über Google Maps) und in den Vorrat legen",
  "Kunden-Tagesbetrieb: werktags Kunden suchen, prüfen und nach deiner Morgen-Freigabe automatisch anschreiben",
  "Tagesbericht über alles, was ich an einem Tag gemacht habe",
  "rankpilot auf Software-Verzeichnissen und Bewertungsplattformen eintragen: Plattformen recherchieren, in meinem eigenen Chrome registrieren und das Profil ausfüllen; Captcha, Bestätigungen und das finale Speichern machst du; Passwörter liegen nur im Schlüsselbund",
  "Tagesüberblick auf „Was liegt heute an?“: was auf dich wartet, was läuft, Zahlen seit gestern",
  "zeigen, was die Mails gebracht haben: Antworten, gestartete rankPilot Checks und neue Konten je Kampagne",
  "Adressen auf die Sperrliste setzen",
  "Claude Code Programmier-Aufträge an deinen Projekten geben (alle Git-Projekte unter Projekte/joachim), das Ergebnis prüfen und nach deinem Ja übernehmen bzw. live stellen",
];

const NICHT = [
  "keine Bildschirmsteuerung und keine Klicks in anderen Programmen (nur in meinem eigenen Browserfenster für Plattform-Einträge)",
  "keine Bewertungen schreiben, keine Kommentare mit Links, keine Forenbeiträge",
  "keinen Kalender, keine Dateien außer meinen Listen und Vorlagen",
];

export const novaStatusTool: NovaToolDefinition = {
  name: "nova_status",
  description:
    "Selbstauskunft über NOVA: was sie kann, was nicht, was gerade läuft und was ihr für ihre Aufgaben noch fehlt (Vorlagen, Freigaben, Signatur, Gedächtnis, Tagesbetrieb). Aufrufen, wenn Joachim fragt, was du kannst, was du brauchst oder was läuft – oder wenn eine Aufgabe an etwas Fehlendem scheitert.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  async execute(_args, ctx) {
    const vorlagen = leseVorlagen().map((vorlage) => vorlage.name);
    const tagesbetrieb = leseEinstellungen();
    const [mailDauer, scannerDauer, laufend] = await Promise.all([
      findMatchingPolicy({ organizationId: ctx.organizationId, actionType: "mail.send" }),
      findMatchingPolicy({ organizationId: ctx.organizationId, actionType: "scanner.start" }),
      prisma.campaign.findMany({ where: { organizationId: ctx.organizationId, status: { in: ["laeuft", "wartet_auf_freigabe"] } } }),
    ]);
    const firma = lesenGedaechtnis("firma");

    const fehlt: string[] = [];
    if (/Noch nichts hinterlegt/.test(firma)) fehlt.push("Ich weiß noch nichts über deine Firma – sag „Merk dir: …“.");
    if (!vorlagen.includes("kunden")) fehlt.push("Kunden-Vorlage (~/Nova/vorlagen/kunden.md) – ohne sie kann ich keine Kunden anschreiben und der Tagesbetrieb startet nicht.");
    if (!vorlagen.includes("sponsoren")) fehlt.push("Sponsoren-Vorlage (~/Nova/vorlagen/sponsoren.md).");
    if (!alleSignaturen().length) fehlt.push("Signatur-Zuordnung (~/Nova/signaturen.txt).");
    if (!process.env.RANKPILOT_CHECKS_TOKEN?.trim()) fehlt.push("Schlüssel für die Check-Zählung (RANKPILOT_CHECKS_TOKEN in NOVAs .env) – ohne ihn sehe ich nicht, wer über meine Mails den Check startet.");
    if (tagesbetrieb.aktiv && !vorlagen.includes(tagesbetrieb.vorlage)) fehlt.push(`Der Tagesbetrieb ist an, aber die Vorlage „${tagesbetrieb.vorlage}“ fehlt.`);

    return {
      ok: true,
      executed: false,
      data: {
        kann: FAEHIGKEITEN,
        kann_nicht: NICHT,
        stand: {
          vorlagen,
          kontaktlisten: kontaktlistenNamen().filter((name) => name !== "sperrliste"),
          dauerfreigabe_mail: mailDauer ? mailDauer.name : "keine – ich frage vor jedem Senden",
          dauerfreigabe_scanner: scannerDauer ? scannerDauer.name : "keine – ich frage vor jeder Suche",
          tagesbetrieb: tagesbetrieb.aktiv
            ? `an: ${tagesbetrieb.start}–${tagesbetrieb.ende} Uhr, bis ${tagesbetrieb.maxProTag} Mails, alle ${tagesbetrieb.abstandMinuten} Minuten, Vorlage „${tagesbetrieb.vorlage}“`
            : "aus",
          projekte_fuer_claude: leseProjekte().map((p) => ({
            name: p.name,
            beschreibung: p.beschreibung,
            bereit: p.zustand === "bereit",
            github: p.remote,
            veroeffentlichen: p.live ? "per Skript" : "nur übernehmen",
          })),
          ordner_ohne_git: ordnerOhneGit(),
          laufende_kampagnen: laufend.map((kampagne) => `${kampagne.name} (${kampagne.status.replace(/_/g, " ")})`),
        },
        fehlt,
      },
    };
  },
};
