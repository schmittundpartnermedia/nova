import type { NovaAgent } from "@/types/agents";
import { getOrganizationConnectors } from "@/connectors/registry";
import { parseWhen, guessTitle } from "@/lib/calendar/when";

function localWhen(value: Date | string | undefined): string {
  if (!value) return "?";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "?";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

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

    if (
      /\b(apple|google|outlook|icloud)\b.{0,40}\bkalender\b/i.test(lower) ||
      /\bkalender\b.{0,40}\b(apple|google|outlook|icloud)\b/i.test(lower) ||
      /\b(verbind|koppel|sync|synchron)\b.{0,40}\b(apple|google|outlook|icloud).{0,20}kalender\b/i.test(lower) ||
      /\bexterne[rnms]?\s+kalender\b/i.test(lower)
    ) {
      return {
        ok: true,
        summary:
          "Es gibt keinen verbundenen Apple-, Google- oder Outlook-Kalender. Termine laufen nur im lokalen NOVA-Kalender.",
        data: { executed: false, action: "external_unavailable", provider: calendar.id },
      };
    }

    if (/\b(absag|lösch|stornier)\b/i.test(lower) || /\bsag(?:e|t|en)?\b.{0,80}\bab\b/i.test(lower)) {
      const from = new Date();
      const to = new Date(from.getTime() + 120 * 24 * 60 * 60 * 1000);
      const events = (await calendar.list(context.organizationId, from, to)) as Array<{
        id?: string;
        title?: string;
        startsAt?: Date | string;
      }>;
      const titled = events.filter((item) => item.id && item.title);
      const matched = titled.filter((item) => {
        const title = String(item.title).toLowerCase().replace(/^(?:an|für|fuer)\s*:?\s+/, "").trim();
        return Boolean(title) && (lower.includes(title) || title.includes(lower.replace(/^.*?termin\s+/i, "").replace(/\s+ab\s*$/i, "").trim()));
      });
      const target = matched.length === 1 ? matched[0] : titled.length === 1 ? titled[0] : null;
      if (!target?.id) {
        const lines = titled.slice(0, 8).map((item) => {
          const when = localWhen(item.startsAt);
          return `- ${when} ${item.title}`;
        });
        return {
          ok: false,
          summary: titled.length
            ? `Welchen Termin soll ich absagen?\n${lines.join("\n")}`
            : "Im NOVA-Kalender liegt kein Termin zum Absagen.",
          data: { executed: false, action: "cancel" },
        };
      }
      const cancelled = await calendar.cancel(context.organizationId, target.id);
      return {
        ok: cancelled.ok && cancelled.executed,
        summary: cancelled.reason,
        data: { executed: cancelled.executed, action: "cancel", eventId: target.id },
      };
    }

    if (
      /\b(list|übersicht|was steht|welche termine|zeige termine|stehen an)\b/i.test(lower) ||
      (/\btermine?\b/i.test(lower) && !/\banleg|erstell|trag/i.test(lower))
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
          const when = localWhen(item.startsAt);
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
