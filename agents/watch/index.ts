import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export type WatchScan = {
  overdueTasks: Array<{ id: string; title: string; dueAt: Date | null }>;
  staleDrafts: Array<{ id: string; subject: string; createdAt: Date }>;
  upcomingMeetings: Array<{ id: string; title: string; startsAt: Date }>;
};

export async function scanWatch(organizationId: string): Promise<WatchScan> {
  assertOrganizationId(organizationId);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [overdueTasks, staleDrafts, upcomingMeetings] = await Promise.all([
    prisma.task.findMany({
      where: {
        organizationId,
        status: "open",
        dueAt: { lte: now },
      },
      orderBy: { dueAt: "asc" },
      take: 12,
      select: { id: true, title: true, dueAt: true, organizationId: true },
    }),
    prisma.communication.findMany({
      where: {
        organizationId,
        status: "prepared",
        createdAt: { lte: weekAgo },
      },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: { id: true, subject: true, createdAt: true, organizationId: true },
    }),
    prisma.meeting.findMany({
      where: {
        organizationId,
        startsAt: { gte: now, lte: weekAhead },
      },
      orderBy: { startsAt: "asc" },
      take: 8,
      select: { id: true, title: true, startsAt: true, organizationId: true },
    }),
  ]);

  return {
    overdueTasks: overdueTasks.filter((item) => item.organizationId === organizationId),
    staleDrafts: staleDrafts.filter((item) => item.organizationId === organizationId),
    upcomingMeetings: upcomingMeetings.filter((item) => item.organizationId === organizationId),
  };
}

function formatScan(scan: WatchScan): string {
  const parts: string[] = [];
  if (scan.overdueTasks.length) {
    parts.push(
      `Überfällige Aufgaben:\n${scan.overdueTasks
        .map((item) => `- ${item.title}${item.dueAt ? ` (seit ${item.dueAt.toISOString().slice(0, 10)})` : ""}`)
        .join("\n")}`,
    );
  }
  if (scan.staleDrafts.length) {
    parts.push(
      `Mail-Entwürfe ohne Versand (älter als eine Woche):\n${scan.staleDrafts
        .map((item) => `- ${item.subject}`)
        .join("\n")}`,
    );
  }
  if (scan.upcomingMeetings.length) {
    parts.push(
      `Termine diese Woche:\n${scan.upcomingMeetings
        .map((item) => `- ${item.startsAt.toISOString().slice(0, 16).replace("T", " ")} ${item.title}`)
        .join("\n")}`,
    );
  }
  if (!parts.length) return "Nichts Überfälliges, keine alten Entwürfe, keine Termine in den nächsten sieben Tagen.";
  return parts.join("\n\n");
}

export const watchAgent: NovaAgent = {
  definition: {
    id: "watch",
    name: "Watch Agent",
    description: "Deadlines, liegengebliebene Entwürfe, anstehende Termine.",
    capabilities: ["deadlines", "follow-ups", "monitoring"],
    requiredTools: [],
    inputSchema: { userRequest: "string" },
    outputSchema: { scan: "WatchScan" },
    riskLevel: "low",
    implemented: true,
  },
  async run(_input, context) {
    const scan = await scanWatch(context.organizationId);
    const summary = formatScan(scan);
    return {
      ok: true,
      summary,
      data: {
        overdue: scan.overdueTasks.length,
        staleDrafts: scan.staleDrafts.length,
        upcoming: scan.upcomingMeetings.length,
        scan,
      },
    };
  },
};
