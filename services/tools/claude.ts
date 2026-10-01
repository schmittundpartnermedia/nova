import { alleAuftraege, beauftrageClaude, claudeLiveStellen, leseAuftrag } from "@/services/claude";
import type { NovaToolDefinition, NovaToolResult } from "@/services/tools/types";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fehler(error: unknown): NovaToolResult {
  return { ok: false, executed: false, error: error instanceof Error ? error.message : String(error) };
}

export const claudeBeauftragenTool: NovaToolDefinition = {
  name: "claude_beauftragen",
  description: `Gibt Claude Code einen Programmier-Auftrag an einem von Joachims Projekten im Projektordner (Namen und Beschreibungen liefert nova_status; „webseite“ = rankpilot.de, „app“ = app.rankpilot.de). Claude arbeitet im Hintergrund auf einem eigenen Branch, NOVA prüft das Ergebnis und meldet sich; veröffentlicht wird erst nach Joachims Ja (claude_live). Formuliere die Aufgabe vollständig und konkret; frag nach, wenn Wesentliches fehlt (z. B. die neue Telefonnummer).`,
  parameters: {
    type: "object",
    properties: {
      projekt: { type: "string", description: "Projektname (Ordnername klein, z. B. planexus, adfiltec) oder webseite/app." },
      aufgabe: { type: "string" },
      abnahmekriterium: { type: "string", description: "Woran Joachim sieht, dass es fertig ist. Leer, wenn er nichts sagt." },
    },
    required: ["projekt", "aufgabe", "abnahmekriterium"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const auftrag = await beauftrageClaude({
        organizationId: ctx.organizationId,
        projekt: str(args.projekt),
        aufgabe: str(args.aufgabe),
        abnahmekriterium: str(args.abnahmekriterium),
      });
      return { ok: true, executed: true, data: { auftrag_id: auftrag.id, projekt: auftrag.projekt, status: auftrag.status } };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const claudeStatusTool: NovaToolDefinition = {
  name: "claude_status",
  description: "Stand eines Claude-Auftrags (oder der letzten Aufträge, wenn auftrag_id leer): Status, Zusammenfassung von Claude, geänderte Dateien, NOVAs Prüfung, Live-Ergebnis.",
  parameters: {
    type: "object",
    properties: { auftrag_id: { type: "string" } },
    required: ["auftrag_id"],
    additionalProperties: false,
  },
  execute(args) {
    try {
      const id = str(args.auftrag_id);
      if (id) {
        const a = leseAuftrag(id);
        return { ok: true, executed: false, data: { ...a, pruefung: a.pruefung?.map((item) => ({ befehl: item.befehl, ok: item.ok })) } };
      }
      return {
        ok: true,
        executed: false,
        data: { auftraege: alleAuftraege().slice(0, 5).map((a) => ({ auftrag_id: a.id, projekt: a.projekt, status: a.status, aufgabe: a.aufgabe.slice(0, 120) })) },
      };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const claudeLiveTool: NovaToolDefinition = {
  name: "claude_live",
  description:
    "Stellt einen fertigen, geprüften Claude-Auftrag live (übernehmen in den Hauptzweig, pushen, Live-Skript). Ohne freigabe_id kommt freigabe_noetig zurück – dann einmal knapp fragen und erst nach Joachims Ja mit der freigabe_id erneut aufrufen.",
  parameters: {
    type: "object",
    properties: { auftrag_id: { type: "string" }, freigabe_id: { type: "string", description: "Nur nach Joachims Ja. Sonst leer." } },
    required: ["auftrag_id", "freigabe_id"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    try {
      const result = await claudeLiveStellen({ organizationId: ctx.organizationId, auftragId: str(args.auftrag_id), freigabeId: str(args.freigabe_id) || undefined });
      return { ok: true, executed: result.status === "wird_live", data: result };
    } catch (error) {
      return fehler(error);
    }
  },
};

export const CLAUDE_TOOLS: NovaToolDefinition[] = [claudeBeauftragenTool, claudeStatusTool, claudeLiveTool];
