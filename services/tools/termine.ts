import { aendereTermin, legeTerminAn, leseBeginn, termineAnzeigen } from "@/services/termine";
import type { NovaToolDefinition } from "@/services/tools/types";

const BEGINN =
  "Datum und Uhrzeit als ISO ohne Zeitzone, z. B. 2026-10-08T10:00 (Zeit des Macs). „Donnerstag“ ohne Uhrzeit: frag nach oder nimm 10:00 und sag es.";

export const terminAnlegenTool: NovaToolDefinition = {
  name: "termin_anlegen",
  description:
    "Termin oder Rückruf speichern; NOVA erinnert Joachim vorher (Standard 15 Minuten). Nur auf Joachims Wunsch oder sein Ja zu deinem Vorschlag, nie von dir aus. " +
    "in_kalender true trägt ihn zusätzlich in Joachims Apple Kalender ein (wenn er das will oder nichts dagegen sagt). Titel kurz und eindeutig, z. B. „Rückruf Schreinerei Weber, 07231 12345“.",
  parameters: {
    type: "object",
    properties: {
      titel: { type: "string" },
      beginn: { type: "string", description: BEGINN },
      dauer_minuten: { type: ["integer", "null"], description: "Standard 30." },
      notiz: { type: ["string", "null"], description: "Worum es geht, Telefonnummer, Ansprechpartner." },
      erinnerung_minuten: { type: ["integer", "null"], description: "So viele Minuten vorher erinnern; Standard 15, 0 = keine Erinnerung." },
      in_kalender: { type: "boolean" },
      quelle_id: { type: ["string", "null"], description: "ID der Mail (communication), aus der der Termin stammt, falls bekannt." },
    },
    required: ["titel", "beginn", "dauer_minuten", "notiz", "erinnerung_minuten", "in_kalender", "quelle_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const beginn = leseBeginn(args.beginn);
    if (!beginn) return { ok: false, executed: false, error: "Zeitpunkt nicht lesbar." };
    try {
      const r = await legeTerminAn({
        organizationId: ctx.organizationId,
        titel: String(args.titel ?? ""),
        beginn,
        dauerMinuten: typeof args.dauer_minuten === "number" ? args.dauer_minuten : undefined,
        notiz: typeof args.notiz === "string" ? args.notiz : undefined,
        erinnerungMinuten: typeof args.erinnerung_minuten === "number" ? args.erinnerung_minuten : undefined,
        quelleId: typeof args.quelle_id === "string" ? args.quelle_id : undefined,
        inKalender: args.in_kalender === true,
      });
      return { ok: true, executed: true, data: r };
    } catch (error) {
      return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const termineAnzeigenTool: NovaToolDefinition = {
  name: "termine_anzeigen",
  description: "Gespeicherte Termine und Rückrufe in einem Zeitraum (Standard: ab jetzt 14 Tage). Für „Was steht an?“, „Wann rufe ich Weber an?“ und um die termin_id zum Ändern zu finden.",
  parameters: {
    type: "object",
    properties: {
      von: { type: ["string", "null"], description: "ISO-Datum; Standard jetzt." },
      bis: { type: ["string", "null"], description: "ISO-Datum; Standard 14 Tage nach von." },
      auch_erledigte: { type: "boolean" },
    },
    required: ["von", "bis", "auch_erledigte"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const von = leseBeginn(args.von) ?? new Date();
    const bis = leseBeginn(args.bis) ?? new Date(von.getTime() + 14 * 86_400_000);
    return { ok: true, executed: false, data: await termineAnzeigen({ organizationId: ctx.organizationId, von, bis, auchErledigte: args.auch_erledigte === true }) };
  },
};

export const terminAendernTool: NovaToolDefinition = {
  name: "termin_aendern",
  description:
    "Termin verschieben, umbenennen, als erledigt markieren oder absagen. Steht er im Apple Kalender, wird er dort mitgeändert bzw. bei Absage entfernt. in_kalender true trägt einen bisher nur bei NOVA gespeicherten Termin nachträglich ein.",
  parameters: {
    type: "object",
    properties: {
      termin_id: { type: "string" },
      titel: { type: ["string", "null"] },
      beginn: { type: ["string", "null"], description: BEGINN },
      dauer_minuten: { type: ["integer", "null"] },
      notiz: { type: ["string", "null"] },
      erinnerung_minuten: { type: ["integer", "null"] },
      status: { type: ["string", "null"], enum: ["erledigt", "abgesagt", null] },
      in_kalender: { type: "boolean" },
    },
    required: ["termin_id", "titel", "beginn", "dauer_minuten", "notiz", "erinnerung_minuten", "status", "in_kalender"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const beginn = args.beginn == null ? undefined : leseBeginn(args.beginn);
    if (beginn === null) return { ok: false, executed: false, error: "Zeitpunkt nicht lesbar." };
    try {
      const r = await aendereTermin({
        organizationId: ctx.organizationId,
        id: String(args.termin_id ?? ""),
        titel: typeof args.titel === "string" ? args.titel : undefined,
        beginn,
        dauerMinuten: typeof args.dauer_minuten === "number" ? args.dauer_minuten : undefined,
        notiz: typeof args.notiz === "string" ? args.notiz : undefined,
        erinnerungMinuten: typeof args.erinnerung_minuten === "number" ? args.erinnerung_minuten : undefined,
        status: args.status === "erledigt" || args.status === "abgesagt" ? args.status : undefined,
        inKalender: args.in_kalender === true,
      });
      return { ok: true, executed: true, data: r };
    } catch (error) {
      return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const TERMIN_TOOLS = [terminAnlegenTool, termineAnzeigenTool, terminAendernTool];
