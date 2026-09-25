import type { NovaAgent } from "@/types/agents";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { listDueFollowUps } from "@/services/mail/followup";

export type WatchScan = {
  overdueTasks: Array<{ id: string; title: string; dueAt: Date | null }>;
  staleDrafts: Array<{ id: string; subject: string; createdAt: Date }>;
  upcomingMeetings: Array<{ id: string; title: string; startsAt: Date }>;
  soonMeetings: Array<{ id: string; title: string; startsAt: Date }>;
  newImportantMail: Array<{ id: string; subject: string; from: string }>;
  overdueFollowUps: Array<{ id: string; reason: string; dueAt: Date }>;
};

const SOON_MS = 15 * 60 * 1000;

export async function scanWatch(organizationId: string): Promise<WatchScan> {
  assertOrganizationId(organizationId);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [overdueTasks, staleDrafts, upcomingMeetings, newImportantMail, overdueFollowUps] = await Promise.all([
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
    prisma.mailMessage.findMany({
      where: {
        organizationId,
        direction: "inbound",
        isRead: false,
        receivedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        classification: { in: ["IMPORTANT", "ACTION_REQUIRED", "REPLY_REQUIRED"] },
      },
      orderBy: { receivedAt: "desc" },
      take: 5,
      select: { id: true, subject: true, fromName: true, fromAddress: true, organizationId: true },
    }),
    listDueFollowUps(organizationId, now),
  ]);

  return {
    overdueTasks: overdueTasks.filter((item) => item.organizationId === organizationId),
    staleDrafts: staleDrafts.filter((item) => item.organizationId === organizationId),
    upcomingMeetings: upcomingMeetings.filter((item) => item.organizationId === organizationId),
    soonMeetings: upcomingMeetings.filter(
      (item) => item.organizationId === organizationId && item.startsAt.getTime() - now.getTime() <= SOON_MS,
    ),
    newImportantMail: newImportantMail
      .filter((item) => item.organizationId === organizationId)
      .map((item) => ({ id: item.id, subject: item.subject, from: item.fromName || item.fromAddress })),
    overdueFollowUps: overdueFollowUps
      .filter((item) => item.organizationId === organizationId)
      .map((item) => ({ id: item.id, reason: item.reason, dueAt: item.dueAt })),
  };
}

export function formatWatchScan(scan: WatchScan): string {
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
  if (scan.newImportantMail.length) {
    parts.push(`Neue wichtige Mails:\n${scan.newImportantMail.map((item) => `- ${item.from}: ${item.subject}`).join("\n")}`);
  }
  if (scan.overdueFollowUps.length) {
    parts.push(`Überfällige Follow-ups:\n${scan.overdueFollowUps.map((item) => `- ${item.reason}`).join("\n")}`);
  }
  if (!parts.length) return "Nichts Überfälliges, keine alten Entwürfe, keine Termine in den nächsten sieben Tagen.";
  return parts.join("\n\n");
}

export function watchAlertFingerprint(scan: WatchScan): string {
  const overdue = scan.overdueTasks.map((item) => item.id).sort().join(",");
  const soon = scan.soonMeetings.map((item) => item.id).sort().join(",");
  return `o:${overdue}|s:${soon}`;
}

export function buildWatchAlert(scan: WatchScan): {
  fingerprint: string;
  speak: boolean;
  message: string;
  overdue: number;
  soon: number;
} {
  const fingerprint = watchAlertFingerprint(scan);
  const lines: string[] = [];
  if (scan.soonMeetings.length) {
    lines.push(
      `Gleich: ${scan.soonMeetings
        .map((item) => `${item.title} um ${item.startsAt.toISOString().slice(11, 16)}`)
        .join("; ")}`,
    );
  }
  if (scan.overdueTasks.length) {
    lines.push(
      `Überfällig: ${scan.overdueTasks
        .slice(0, 3)
        .map((item) => item.title)
        .join("; ")}`,
    );
  }
  if (scan.newImportantMail.length) {
    lines.push(`Neue Mail: ${scan.newImportantMail.slice(0, 2).map((item) => item.subject).join("; ")}`);
  }
  if (scan.overdueFollowUps.length) {
    lines.push(`Follow-up überfällig: ${scan.overdueFollowUps[0]?.reason}`);
  }
  return {
    fingerprint,
    speak: lines.length > 0,
    message: lines.join(". ") || "Nichts Dringendes.",
    overdue: scan.overdueTasks.length,
    soon: scan.soonMeetings.length,
  };
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
    const summary = formatWatchScan(scan);
    return {
      ok: true,
      summary,
      data: {
        overdue: scan.overdueTasks.length,
        staleDrafts: scan.staleDrafts.length,
        upcoming: scan.upcomingMeetings.length,
        soon: scan.soonMeetings.length,
        scan,
      },
    };
  },
};
