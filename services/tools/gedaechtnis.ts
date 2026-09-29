import {
  ergaenzeGedaechtnis,
  lesenGedaechtnis,
  parseGedaechtnisDatei,
  schreibenGedaechtnis,
} from "@/lib/gedaechtnis/store";
import type { NovaToolDefinition, NovaToolResult, ToolContext } from "@/services/tools/types";

const DATEI_SCHEMA = {
  type: "string" as const,
  enum: ["firma", "kunden", "projekte"],
  description: "Welche Gedächtnisdatei: firma, kunden oder projekte.",
};

export const gedaechtnisLesenTool: NovaToolDefinition = {
  name: "gedaechtnis_lesen",
  description:
    "Liest eine Datei aus dem Dauergedächtnis (~/Nova/gedaechtnis/). Nutze das, wenn du den aktuellen Stand von Firma, Kunden oder Projekten brauchst.",
  parameters: {
    type: "object",
    properties: { datei: DATEI_SCHEMA },
    required: ["datei"],
    additionalProperties: false,
  },
  execute(args, _ctx: ToolContext): NovaToolResult {
    try {
      const datei = parseGedaechtnisDatei(args.datei);
      const inhalt = lesenGedaechtnis(datei);
      return { ok: true, executed: false, data: { datei, inhalt } };
    } catch (error) {
      return {
        ok: false,
        executed: false,
        error: error instanceof Error ? error.message : "Lesen fehlgeschlagen.",
      };
    }
  },
};

export const gedaechtnisSchreibenTool: NovaToolDefinition = {
  name: "gedaechtnis_schreiben",
  description:
    "Schreibt ins Dauergedächtnis. Bei „Merk dir …“ immer dieses Werkzeug nutzen. Standard: Eintrag anhängen (modus=ergaenzen). Zum Ersetzen der ganzen Datei modus=ersetzen setzen. datei: firma | kunden | projekte.",
  parameters: {
    type: "object",
    properties: {
      datei: DATEI_SCHEMA,
      inhalt: {
        type: "string",
        description: "Der zu merkende Inhalt in klaren Sätzen oder Stichpunkten.",
      },
      modus: {
        type: "string",
        enum: ["ergaenzen", "ersetzen"],
        description: "ergaenzen = anhängen (Standard). ersetzen = ganze Datei überschreiben.",
      },
    },
    required: ["datei", "inhalt", "modus"],
    additionalProperties: false,
  },
  execute(args, _ctx: ToolContext): NovaToolResult {
    try {
      const datei = parseGedaechtnisDatei(args.datei);
      const inhalt = String(args.inhalt ?? "");
      const modus = String(args.modus ?? "ergaenzen") === "ersetzen" ? "ersetzen" : "ergaenzen";
      const geschrieben =
        modus === "ersetzen" ? schreibenGedaechtnis(datei, inhalt) : ergaenzeGedaechtnis(datei, inhalt);
      return {
        ok: true,
        executed: false,
        data: { datei, modus, inhalt: geschrieben },
      };
    } catch (error) {
      return {
        ok: false,
        executed: false,
        error: error instanceof Error ? error.message : "Schreiben fehlgeschlagen.",
      };
    }
  },
};
