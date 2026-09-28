import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

const PAUSED = ["paused", "interrupted", "waiting_for_approval", "INTERRUPTED", "PAUSED", "WAITING_FOR_APPROVAL"] as const;

/** Beim Start: pausierte / unterbrochene Jobs dem Nutzer nennen. */
export async function listResumableJobs(organizationId: string) {
  assertOrganizationId(organizationId);
  return prisma.job.findMany({
    where: {
      organizationId,
      status: { in: [...PAUSED] },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      userRequest: true,
      goal: true,
      pauseReason: true,
      createdAt: true,
    },
  });
}

export async function resumePromptMessage(organizationId: string): Promise<string | null> {
  const jobs = await listResumableJobs(organizationId);
  if (!jobs.length) return null;
  const lines = jobs.slice(0, 5).map((job, index) => {
    const title = (job.goal || job.userRequest || "Auftrag").slice(0, 80);
    return `${index + 1}. ${title} (${job.status})`;
  });
  return `Es gibt unterbrochene Aufträge:\n${lines.join("\n")}\nSoll ich fortsetzen? Sag „mach weiter“.`;
}
