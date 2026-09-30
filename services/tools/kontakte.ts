import { haengeKontaktAn, kontaktlistenNamen, leseKontaktliste } from "@/lib/mail/kontaktlisten";
import { createStandingPolicy, revokeStandingPolicy } from "@/services/approvals";
import { starteKundensuche } from "@/services/leads";
import type { NovaToolDefinition, NovaToolResult } from "@/services/tools/types";

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fehler(error: unknown): NovaToolResult {
  return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
}

export const kundenSuchenTool: NovaToolDefinition = {
  name: "kunden_suchen",
  description:
    "Sucht mit Joachims Lead-Scanner (Google Places + Impressum) lokale Betriebe als potenzielle rankPilot-KUNDEN, z. B. Schreinereien in Pforzheim. Nicht für Sponsoren. Kostet API-Anfragen: Ohne Dauerfreigabe kommt freigabe_noetig mit freigabe_id und Kosten zurück – dann einmal fragen („20 Schreinereien in Pforzheim, ca. 0,04 $ – los?“) und nach dem Ja mit derselben Branche/Ort/Anzahl und der freigabe_id erneut aufrufen. Der Lauf dauert einige Minuten im Hintergrund; NOVA meldet sich, wenn die Kundenliste fertig ist.",
  parameters: {
    type: "object",
    properties: {
      branche: { type: "string" },
      ort: { type: "string" },
      anzahl: { type: "integer", description: "1–60 Betriebe. Wenn der Nutzer nichts sagt: 20." },
      freigabe_id: { type: "string", description: "Nur nach Ja des Nutzers: freigabe_id aus der Rückfrage. Sonst leer." },
    },
    required: ["branche", "ort", "anzahl", "freigabe_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const result = await starteKundensuche({
        organizationId: ctx.organizationId,
        auftrag: { branche: str(args.branche), ort: str(args.ort), anzahl: Number(args.anzahl) },
        freigabeId: str(args.freigabe_id) || undefined,
      });
      return { ok: true, executed: result.status === "gestartet", data: result };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const freigabeScannerDauerTool: NovaToolDefinition = {
  name: "freigabe_scanner_dauer",
  description:
    "Dauerfreigabe für den Lead-Scanner erteilen oder widerrufen (nur auf ausdrückliche Anweisung). Danach startet kunden_suchen ohne Rückfrage, solange das Tageslimit an Läufen nicht erreicht ist.",
  parameters: {
    type: "object",
    properties: {
      aktion: { type: "string", enum: ["erteilen", "widerrufen"] },
      max_pro_tag: { type: "integer", description: "Tageslimit an Scanner-Läufen; 0 = kein Limit. Wenn der Nutzer nichts sagt: 5." },
    },
    required: ["aktion", "max_pro_tag"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      if (str(args.aktion) === "widerrufen") {
        const count = await revokeStandingPolicy({ organizationId: ctx.organizationId, actionType: "scanner.start" });
        return { ok: true, executed: count > 0, data: { widerrufen: count } };
      }
      const max = Math.max(0, Math.round(Number(args.max_pro_tag) || 0));
      const policy = await createStandingPolicy({
        organizationId: ctx.organizationId,
        name: "Lead-Scanner starten",
        actionType: "scanner.start",
        limits: max > 0 ? { maxPerDay: max } : {},
      });
      return { ok: true, executed: true, data: { freigabe: policy.name, max_pro_tag: max || "kein Limit" } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const kontaktHinzufuegenTool: NovaToolDefinition = {
  name: "kontakt_hinzufuegen",
  description:
    "Trägt einen Kontakt in eine Kontaktliste (~/Nova/kampagnen/<liste>.csv) ein, z. B. Sponsoren, die Joachim selbst gefunden hat. anrede ist die vollständige Anredezeile: „Sehr geehrter Herr Wolf“, „Sehr geehrte Frau Berg“, ohne Person „Sehr geehrtes <Firma>-Team“. Ist das Geschlecht unklar, fragen statt raten. bereich ist der Leistungsbereich der Firma aus Sicht der Vorlage (z. B. „Unternehmens- und Gewerbeversicherungen“).",
  parameters: {
    type: "object",
    properties: {
      liste: { type: "string", description: "Name der Liste ohne .csv, z. B. sponsoren." },
      firma: { type: "string" },
      ansprechpartner: { type: "string", description: "Name der Person oder leer." },
      anrede: { type: "string" },
      email: { type: "string" },
      bereich: { type: "string" },
    },
    required: ["liste", "firma", "ansprechpartner", "anrede", "email", "bereich"],
    additionalProperties: false,
  },
  execute(args) {
    try {
      const email = str(args.email);
      if (!EMAIL.test(email)) return { ok: false, executed: false, error: `„${email}“ ist keine gültige Mail-Adresse.` };
      if (!str(args.firma) || !str(args.anrede)) return { ok: false, executed: false, error: "Firma und Anrede sind nötig." };
      const result = haengeKontaktAn(str(args.liste), {
        firma: str(args.firma),
        ansprechpartner: str(args.ansprechpartner),
        anrede: str(args.anrede),
        email,
        bereich: str(args.bereich),
      });
      return {
        ok: true,
        executed: result.neu,
        data: { ...result, hinweis: result.neu ? undefined : "Adresse stand schon in der Liste." },
      };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const kontaktlisteAnzeigenTool: NovaToolDefinition = {
  name: "kontaktliste_anzeigen",
  description: "Zeigt eine Kontaktliste aus ~/Nova/kampagnen/ (Firmen, Ansprechpartner, Anrede, E-Mail …). liste leer = Namen aller Listen.",
  parameters: {
    type: "object",
    properties: { liste: { type: "string" } },
    required: ["liste"],
    additionalProperties: false,
  },
  execute(args) {
    try {
      const liste = str(args.liste);
      if (!liste) return { ok: true, executed: false, data: { kontaktlisten: kontaktlistenNamen() } };
      const zeilen = leseKontaktliste(liste);
      return {
        ok: true,
        executed: false,
        data: {
          liste,
          anzahl: zeilen.length,
          kontakte: zeilen.slice(0, 60).map((zeile) => {
            const { befunde: _befunde, aufhaenger: _aufhaenger, ...rest } = zeile.werte;
            return rest;
          }),
        },
      };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const KONTAKT_TOOLS: NovaToolDefinition[] = [
  kundenSuchenTool,
  freigabeScannerDauerTool,
  kontaktHinzufuegenTool,
  kontaktlisteAnzeigenTool,
];
