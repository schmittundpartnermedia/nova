import fs from "node:fs";
import { schreibeEinstellungen, lokalesDatum } from "@/services/tagesbetrieb/einstellungen";
import { planeTagesbetriebTick, tagesbetriebFreigeben, tagesbetriebStand } from "@/services/tagesbetrieb";
import { sperrlisteDatei } from "@/services/tagesbetrieb/pruefen";
import { kampagnenDir } from "@/lib/mail/kontaktlisten";
import { schreibeTagesbericht } from "@/services/tagesbericht";
import type { NovaToolDefinition, NovaToolResult } from "@/services/tools/types";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fehler(error: unknown): NovaToolResult {
  return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
}

export const tagesbetriebTool: NovaToolDefinition = {
  name: "tagesbetrieb",
  description:
    "Kunden-Tagesbetrieb: werktags sucht NOVA über den Lead-Scanner neue lokale Betriebe, prüft jede Adresse und schickt nach Joachims täglicher Freigabe einer Beispiel-Mail alle paar Minuten eine Mail mit der Kunden-Vorlage, bis zum Tageslimit oder Feierabend; danach Tagesbericht. aktion: einschalten, ausschalten, stand. Werte ändern nur, wenn Joachim es sagt; sonst leer bzw. 0 lassen (dann bleibt die Einstellung).",
  parameters: {
    type: "object",
    properties: {
      aktion: { type: "string", enum: ["einschalten", "ausschalten", "stand"] },
      max_pro_tag: { type: "integer", description: "0 = unverändert" },
      abstand_minuten: { type: "integer", description: "0 = unverändert" },
      start: { type: "string", description: "HH:MM oder leer" },
      ende: { type: "string", description: "HH:MM oder leer" },
      vorlage: { type: "string", description: "Vorlagenname oder leer" },
    },
    required: ["aktion", "max_pro_tag", "abstand_minuten", "start", "ende", "vorlage"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const aktion = str(args.aktion);
      if (aktion === "stand") return { ok: true, executed: false, data: await tagesbetriebStand(ctx.organizationId) };
      const zeit = /^\d{1,2}:\d{2}$/;
      const neu: Record<string, unknown> = { aktiv: aktion === "einschalten", organizationId: ctx.organizationId };
      if (Number(args.max_pro_tag) > 0) neu.maxProTag = Math.round(Number(args.max_pro_tag));
      if (Number(args.abstand_minuten) > 0) neu.abstandMinuten = Math.round(Number(args.abstand_minuten));
      if (zeit.test(str(args.start))) neu.start = str(args.start).padStart(5, "0");
      if (zeit.test(str(args.ende))) neu.ende = str(args.ende).padStart(5, "0");
      if (str(args.vorlage)) neu.vorlage = str(args.vorlage);
      const cfg = schreibeEinstellungen(neu);
      if (cfg.aktiv) await planeTagesbetriebTick(ctx.organizationId, new Date(Date.now() + 15_000));
      return { ok: true, executed: true, data: { einstellungen: cfg } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const tagesbetriebFreigebenTool: NovaToolDefinition = {
  name: "tagesbetrieb_freigeben",
  description:
    "Joachims Ja zur morgendlichen Beispiel-Mail des Kunden-Tagesbetriebs: startet den heutigen Versand. Nur nach ausdrücklicher Zustimmung, mit der freigabe_id aus der Meldung (Werkzeugprotokoll).",
  parameters: {
    type: "object",
    properties: { freigabe_id: { type: "string" } },
    required: ["freigabe_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      return { ok: true, executed: true, data: await tagesbetriebFreigeben({ organizationId: ctx.organizationId, freigabeId: str(args.freigabe_id) }) };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const tagesberichtTool: NovaToolDefinition = {
  name: "tagesbericht",
  description: "Erstellt den Tagesbericht (alle gesendeten Mails, Fehler, Antworten, Kundensuchen, verworfene Adressen) als Datei in ~/Nova/berichte/ und gibt die Kurzfassung zurück. datum YYYY-MM-DD oder leer = heute.",
  parameters: {
    type: "object",
    properties: { datum: { type: "string" } },
    required: ["datum"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const datum = /^\d{4}-\d{2}-\d{2}$/.test(str(args.datum)) ? str(args.datum) : lokalesDatum(new Date());
      const bericht = await schreibeTagesbericht({ organizationId: ctx.organizationId, datum, melden: false });
      return { ok: true, executed: true, data: { datei: bericht.datei, kurz: bericht.kurz } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const sperrlisteTool: NovaToolDefinition = {
  name: "sperrliste_hinzufuegen",
  description: "Setzt eine Adresse oder eine ganze Domain (@firma.de) auf die Sperrliste: wird nie wieder angeschrieben. Z. B. wenn jemand um keine weiteren Mails bittet.",
  parameters: {
    type: "object",
    properties: { eintrag: { type: "string" }, grund: { type: "string" } },
    required: ["eintrag", "grund"],
    additionalProperties: false,
  },
  execute(args) {
    try {
      const eintrag = str(args.eintrag).toLowerCase();
      if (!/^@?[^\s@]+(@[^\s@]+)?\.[^\s@]+$/.test(eintrag)) return { ok: false, executed: false, error: `„${eintrag}“ ist keine Adresse oder Domain.` };
      fs.mkdirSync(kampagnenDir(), { recursive: true });
      fs.appendFileSync(sperrlisteDatei(), `${eintrag}${str(args.grund) ? `  # ${str(args.grund)}` : ""}\n`, "utf8");
      return { ok: true, executed: true, data: { eintrag, datei: sperrlisteDatei() } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const TAGESBETRIEB_TOOLS: NovaToolDefinition[] = [tagesbetriebTool, tagesbetriebFreigebenTool, tagesberichtTool, sperrlisteTool];

