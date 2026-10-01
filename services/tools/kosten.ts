import { kostenUebersicht, zeitraum } from "@/services/kosten";
import type { NovaToolDefinition } from "@/services/tools/types";

export const kostenTool: NovaToolDefinition = {
  name: "kosten_anzeigen",
  description:
    "Was NOVA gekostet hat: OpenAI (Kopf, Stimme, Spracherkennung, Websuche), Claude Code, Google Places. Fehlt für etwas der Preis, sag das ehrlich statt zu schätzen (Preise trägt Joachim in ~/Nova/preise.json ein). Bei Fragen wie „Was hat NOVA heute/diesen Monat gekostet?“.",
  parameters: {
    type: "object",
    properties: { zeitraum: { type: "string", enum: ["heute", "7_tage", "monat", "vormonat"] } },
    required: ["zeitraum"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const { von, bis } = zeitraum(String(args.zeitraum ?? "heute"));
    return { ok: true, executed: false, data: await kostenUebersicht({ organizationId: ctx.organizationId, von, bis }) };
  },
};
