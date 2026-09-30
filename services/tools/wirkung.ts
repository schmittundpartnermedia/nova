import { wirkung } from "@/services/wirkung";
import type { NovaToolDefinition } from "@/services/tools/types";

export const wirkungTool: NovaToolDefinition = {
  name: "wirkung_anzeigen",
  description:
    "Was haben die Mails gebracht? Je Kampagne: gesendet, Antworten, gestartete rankPilot Checks (über den eigenen Link jeder Mail) und daraus angelegte Konten, für die letzten N Tage. Aufrufen bei Fragen wie „Was hat die Kampagne gebracht?“ oder „Wie läuft es?“.",
  parameters: {
    type: "object",
    properties: { tage: { type: "integer", description: "Zeitraum in Tagen (1–90), z. B. 7." } },
    required: ["tage"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const tage = Math.min(Math.max(Math.round(Number(args.tage) || 7), 1), 90);
    const data = await wirkung({ organizationId: ctx.organizationId, seit: new Date(Date.now() - tage * 86_400_000) });
    return { ok: true, executed: false, data: { tage, ...data } };
  },
};
