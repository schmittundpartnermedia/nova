import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { CalendarProvider } from "@/types/connectors";

function asDate(value: unknown, fallback?: Date): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value);
  return fallback ?? null;
}

export class LocalCalendarProvider implements CalendarProvider {
  id = "local-calendar";

  async list(organizationId: string, from: Date, to: Date): Promise<unknown[]> {
    assertOrganizationId(organizationId);
    const rows = await prisma.meeting.findMany({
      where: {
        organizationId,
        startsAt: { gte: from, lte: to },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
    });
    return rows.filter((row) => row.organizationId === organizationId);
  }

  async create(organizationId: string, event: Record<string, unknown>) {
    assertOrganizationId(organizationId);
    const title = String(event.title ?? "").trim();
    const startsAt = asDate(event.startsAt ?? event.start);
    if (!title || !startsAt) {
      return { ok: false, executed: false, reason: "Ohne Titel und Zeitpunkt lege ich keinen Termin an." };
    }
    const created = await prisma.meeting.create({
      data: {
        organizationId,
        title,
        startsAt,
        endsAt: asDate(event.endsAt ?? event.end, new Date(startsAt.getTime() + 60 * 60 * 1000)),
        location: typeof event.location === "string" ? event.location : undefined,
        notes: typeof event.notes === "string" ? event.notes : undefined,
      },
    });
    return {
      ok: true,
      executed: true,
      eventUrl: created.id,
      reason: `Termin „${created.title}“ liegt im NOVA-Kalender, nicht in Google oder Outlook.`,
    };
  }

  async update(organizationId: string, eventId: string, patch: Record<string, unknown>) {
    assertOrganizationId(organizationId);
    const existing = await prisma.meeting.findFirst({
      where: { id: eventId, organizationId },
    });
    if (!existing) {
      return { ok: false, executed: false, reason: "Termin nicht gefunden." };
    }
    await prisma.meeting.update({
      where: { id: existing.id },
      data: {
        title: typeof patch.title === "string" ? patch.title : existing.title,
        startsAt: asDate(patch.startsAt, existing.startsAt) ?? existing.startsAt,
        endsAt: asDate(patch.endsAt, existing.endsAt ?? undefined),
        location: typeof patch.location === "string" ? patch.location : existing.location,
        notes: typeof patch.notes === "string" ? patch.notes : existing.notes,
      },
    });
    return { ok: true, executed: true, reason: "Termin im NOVA-Kalender geändert." };
  }

  async cancel(organizationId: string, eventId: string) {
    assertOrganizationId(organizationId);
    const existing = await prisma.meeting.findFirst({
      where: { id: eventId, organizationId },
    });
    if (!existing) {
      return { ok: false, executed: false, reason: "Termin nicht gefunden." };
    }
    await prisma.meeting.delete({ where: { id: existing.id } });
    return { ok: true, executed: true, reason: "Termin im NOVA-Kalender gelöscht." };
  }

  async getEventUrl(_organizationId: string, eventId: string): Promise<string | null> {
    return eventId || null;
  }
}
