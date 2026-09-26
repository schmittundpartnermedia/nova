import { prisma } from "@/lib/prisma";

const ABANDONED_AFTER_MS = 20 * 60 * 1000;

/** Jobs, die niemand mehr ausführt, dürfen nicht als laufend gelten. */
export async function pauseAbandonedJobs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS);
  const active = await prisma.workItem.findMany({
    where: { status: { in: ["queued", "leased", "running"] }, jobId: { not: null } },
    select: { jobId: true },
  });
  const busy = active.map((item) => item.jobId).filter((id): id is string => Boolean(id));
  const result = await prisma.job.updateMany({
    where: {
      status: "running",
      ...(busy.length ? { id: { notIn: busy } } : {}),
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }],
    },
    data: {
      status: "paused",
      pauseReason: "Kein Prozess führt diesen Auftrag weiter.",
    },
  });
  return result.count;
}

/** Ein abgebrochener Dialog darf den Auftrag nicht als laufend stehen lassen. */
export async function failJobsLeftByFailedRequest(organizationId: string, startedAt: Date): Promise<number> {
  const active = await prisma.workItem.findMany({
    where: {
      organizationId,
      status: { in: ["queued", "leased", "running"] },
      jobId: { not: null },
    },
    select: { jobId: true },
  });
  const busy = active.map((item) => item.jobId).filter((id): id is string => Boolean(id));
  const result = await prisma.job.updateMany({
    where: {
      organizationId,
      status: { in: ["running", "planning"] },
      startedAt: { gte: new Date(startedAt.getTime() - 2000) },
      ...(busy.length ? { id: { notIn: busy } } : {}),
    },
    data: {
      status: "failed",
      pauseReason: "Der Auftrag ist während der Anfrage abgebrochen.",
      completedAt: new Date(),
    },
  });
  return result.count;
}
