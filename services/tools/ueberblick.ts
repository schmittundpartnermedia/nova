import { tagesueberblick } from "@/services/ueberblick";
import type { NovaToolDefinition } from "@/services/tools/types";

export const tagesueberblickTool: NovaToolDefinition = {
  name: "tagesueberblick",
  description:
    "Überblick für Joachim: was auf ihn wartet (Antworten aus Kampagnen, offene Freigaben, nicht gesendete Entwürfe, fertige Claude-Aufträge), was läuft (Kampagnen, Nachfass, Tagesbetrieb) und die Zahlen seit gestern, dazu ungelesene Mails. Aufrufen bei „Was liegt heute an?“, „Was gibt's Neues?“, „Überblick“, „Guten Morgen“.",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  async execute(_args, ctx) {
    const data = await tagesueberblick({ organizationId: ctx.organizationId, postfach: ctx.postfach });
    return { ok: true, executed: false, data };
  },
};
