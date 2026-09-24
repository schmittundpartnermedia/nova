import type { NovaAgent } from "@/types/agents";
import { getOrganizationConnectors } from "@/connectors/registry";
import { parseWhen, guessTitle } from "@/lib/calendar/when";

export const calendarAgent: NovaAgent = {
  definition: {
    id: "calendar",
    name: "Calendar Agent",
    description: "Termine im NOVA-Kalender anlegen, listen und absagen.",
    capabilities: ["calendar", "availability", "meetings"],
    requiredTools: ["calendar"],
    inputSchema: { userRequest: "string" },
    outputSchema: { executed: "boolean", events: "Meeting[]" },
    riskLevel: "medium",
    implemented: true,
  },
  async run(input, context) {
    const request = String(input.userRequest ?? context.userRequest);
    const connectors = await getOrganizationConnectors(context.organizationId);
    const calendar = connectors.calendar;
    const lower = request.toLowerCase();

    if (/\b(absag|lösch|stornier)\b/i.test(lower)) {
      return {
        ok: false,
        summary: "Zum Absagen brauche ich den konkreten Termin aus der Liste, nicht nur „lösch den Termin“.",
        data: { executed: false, action: "cancel" },
      };
    }

    if (
      /\b(list|übersicht|was steht|welche termine|zeige termine)\b/i.test(lower) ||
      (/\btermine\b/i.test(lower) && !/\banleg|erstell|trag/i.test(lower))
    ) {
      const from = new Date();
      const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
      const events = (await calendar.list(context.organizationId, from, to)) as Array<{
        id?: string;
        title?: string;
        startsAt?: Date | string;
      }>;
      const lines = events
        .slice(0, 12)
        .map((item) => {
          const when = item.startsAt ? new Date(item.startsAt).toISOString().slice(0, 16).replace("T", " ") : "?";
          return `- ${when} ${item.title ?? "Termin"}`;
        });
      return {
        ok: true,
        summary: events.length
          ? `Die nächsten Termine im NOVA-Kalender:\n${lines.join("\n")}`
          : "Im NOVA-Kalender steht in den nächsten zwei Wochen nichts.",
        data: { executed: true, action: "list", count: events.length, events },
      };
    }

    const when = parseWhen(request);
    if (!when) {
      return {
        ok: false,
        summary: "Ohne klares Datum lege ich keinen Termin an. Sag mir Tag und Uhrzeit.",
        data: { executed: false, action: "create" },
      };
    }
    const title = guessTitle(request);
    const created = await calendar.create(context.organizationId, {
      title,
      startsAt: when.startsAt.toISOString(),
      endsAt: when.endsAt.toISOString(),
      notes: request.slice(0, 400),
    });
    return {
      ok: created.ok && created.executed,
      summary: created.reason,
      data: {
        executed: created.executed,
        action: "create",
        title,
        startsAt: when.startsAt.toISOString(),
        eventId: created.eventUrl ?? null,
      },
    };
  },
};
