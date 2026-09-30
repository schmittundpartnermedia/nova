import { kontaktlistenNamen } from "@/lib/mail/kontaktlisten";
import { brecheKampagneAb, kampagnenListe, kampagnenStand, planeKampagne, starteKampagne } from "@/services/kampagnen";
import type { NovaToolDefinition, NovaToolResult } from "@/services/tools/types";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fehler(error: unknown): NovaToolResult {
  return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
}

export const kampagnePlanenTool: NovaToolDefinition = {
  name: "kampagne_planen",
  description:
    "Plant eine Mail-Kampagne: Vorlage (vorlage_liste) × Kontaktliste (Datei in ~/Nova/kampagnen/, Spalten wie email, anrede, firma, bereich). Legt alle Entwürfe an und eine Freigabe – sendet nichts. Danach dem Nutzer einmal zusammenfassen (Anzahl, Vorlage, Abstand, Absender, Dauer, ungültige Adressen) und fragen: „… – los?“.",
  parameters: {
    type: "object",
    properties: {
      vorlage: { type: "string" },
      liste: { type: "string", description: "Name der Kontaktliste ohne .csv. Leer lassen, um die vorhandenen Listen zu sehen." },
      abstand_minuten: { type: "integer" },
      absender: { type: "string" },
    },
    required: ["vorlage", "liste", "abstand_minuten", "absender"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      if (!str(args.liste)) {
        return { ok: true, executed: false, data: { kontaktlisten: kontaktlistenNamen() } };
      }
      const plan = await planeKampagne({
        organizationId: ctx.organizationId,
        vorlage: str(args.vorlage),
        liste: str(args.liste),
        absender: str(args.absender),
        abstandMinuten: Number(args.abstand_minuten),
      });
      return { ok: true, executed: true, data: { ...plan, status: "wartet_auf_freigabe" } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const kampagneStartenTool: NovaToolDefinition = {
  name: "kampagne_starten",
  description:
    "Startet eine geplante Kampagne im Hintergrund. Nur nach ausdrücklichem Ja des Nutzers zur Zusammenfassung, mit kampagne_id und freigabe_id aus kampagne_planen. Die Mails gehen dann im eingestellten Abstand raus, auch wenn NOVA geschlossen ist.",
  parameters: {
    type: "object",
    properties: { kampagne_id: { type: "string" }, freigabe_id: { type: "string" } },
    required: ["kampagne_id", "freigabe_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const stand = await starteKampagne({
        organizationId: ctx.organizationId,
        kampagneId: str(args.kampagne_id),
        freigabeId: str(args.freigabe_id),
      });
      return { ok: true, executed: true, data: stand };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const kampagneStatusTool: NovaToolDefinition = {
  name: "kampagne_status",
  description: "Stand einer Kampagne (gesendet, offen, fehlgeschlagen, ungültig, nächste Mail). kampagne_id leer = die letzten Kampagnen.",
  parameters: {
    type: "object",
    properties: { kampagne_id: { type: "string" } },
    required: ["kampagne_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const id = str(args.kampagne_id);
      const data = id ? await kampagnenStand(ctx.organizationId, id) : { kampagnen: await kampagnenListe(ctx.organizationId) };
      return { ok: true, executed: false, data };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const kampagneAbbrechenTool: NovaToolDefinition = {
  name: "kampagne_abbrechen",
  description: "Bricht eine Kampagne ab: Noch nicht gesendete Mails gehen nicht mehr raus. Nur auf Anweisung des Nutzers.",
  parameters: {
    type: "object",
    properties: { kampagne_id: { type: "string" } },
    required: ["kampagne_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const stand = await brecheKampagneAb(ctx.organizationId, str(args.kampagne_id));
      return { ok: true, executed: true, data: stand };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const KAMPAGNE_TOOLS: NovaToolDefinition[] = [
  kampagnePlanenTool,
  kampagneStartenTool,
  kampagneStatusTool,
  kampagneAbbrechenTool,
];
