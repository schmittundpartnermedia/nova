import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { decideExternalEffect, nextRunAt } from "@/lib/worker/policy";

const LEASE_MS = 60_000;

export type WorkStatus =
  | "queued"
  | "leased"
  | "running"
  | "waiting_review"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "needs_verification";

function auditAppend(current: string | null, event: Record<string, unknown>): string {
  const list = current ? (JSON.parse(current) as unknown[]) : [];
  const next = Array.isArray(list) ? list : [];
  next.push({ at: new Date().toISOString(), ...event });
  return JSON.stringify(next.slice(-20));
}

export async function enqueueWorkItem(input: {
  organizationId: string;
  jobId?: string;
  kind: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  status?: WorkStatus;
  maxAttempts?: number;
}) {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.workItem.findFirst({
    where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;
  return prisma.workItem.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      kind: input.kind,
      status: input.status ?? "queued",
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
      idempotencyKey: input.idempotencyKey,
      payload: JSON.stringify(input.payload ?? {}),
      audit: auditAppend(null, { event: "enqueued", kind: input.kind }),
    },
  });
}

export async function leaseDueWork(workerId: string, now = new Date(), limit = 5) {
  const due = await prisma.workItem.findMany({
    where: {
      status: "queued",
      runAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: { runAt: "asc" },
    take: limit,
  });
  const leased = [];
  const until = new Date(now.getTime() + LEASE_MS);
  for (const item of due) {
    const claim = await prisma.workItem.updateMany({
      where: { id: item.id, organizationId: item.organizationId, status: "queued" },
      data: {
        status: "leased",
        lockedBy: workerId,
        lockedUntil: until,
        attempts: { increment: 1 },
      },
    });
    if (claim.count === 1) {
      const owned = await prisma.workItem.findFirst({ where: { id: item.id } });
      if (owned) leased.push(owned);
    }
  }
  return leased;
}

export async function markWorkRunning(id: string, organizationId: string, workerId: string) {
  await prisma.workItem.updateMany({
    where: { id, organizationId, lockedBy: workerId, status: "leased" },
    data: { status: "running", lockedUntil: new Date(Date.now() + LEASE_MS) },
  });
}

/** Hält die Lease, solange der Handler auf Ein-/Ausgabe wartet. Stirbt der Prozess, läuft der Timer nicht weiter. */
export function keepWorkLease(id: string, organizationId: string, workerId: string) {
  const timer = setInterval(() => {
    void prisma.workItem
      .updateMany({
        where: { id, organizationId, lockedBy: workerId, status: "running" },
        data: { lockedUntil: new Date(Date.now() + LEASE_MS) },
      })
      .catch(() => undefined);
  }, 20_000);
  timer.unref();
  return () => clearInterval(timer);
}

export async function loadEffectResult<T>(organizationId: string, idempotencyKey: string): Promise<T | null> {
  const row = await prisma.workEffect.findFirst({
    where: { organizationId, idempotencyKey, status: "committed" },
  });
  if (!row?.result) return null;
  try {
    return JSON.parse(row.result) as T;
  } catch {
    return null;
  }
}

export async function completeWorkItem(id: string, organizationId: string, note?: string) {
  const current = await prisma.workItem.findFirst({ where: { id, organizationId } });
  await prisma.workItem.updateMany({
    where: { id, organizationId },
    data: {
      status: "completed",
      completedAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
      lastError: null,
      audit: auditAppend(current?.audit ?? null, { event: "completed", note: note ?? null }),
    },
  });
}

export async function failWorkItem(input: {
  id: string;
  organizationId: string;
  error: string;
  retry: boolean;
}) {
  const current = await prisma.workItem.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
  if (!current) return;
  const giveUp = !input.retry || current.attempts >= current.maxAttempts;
  await prisma.workItem.updateMany({
    where: { id: input.id, organizationId: input.organizationId },
    data: {
      status: giveUp ? "failed" : "queued",
      runAt: giveUp ? current.runAt : nextRunAt(new Date(), current.attempts),
      lastError: input.error,
      lockedBy: null,
      lockedUntil: null,
      audit: auditAppend(current.audit, { event: giveUp ? "failed" : "retry", error: input.error }),
    },
  });
}

export async function pauseWorkItem(id: string, organizationId: string, reason: string) {
  const current = await prisma.workItem.findFirst({ where: { id, organizationId } });
  await prisma.workItem.updateMany({
    where: { id, organizationId, status: { in: ["queued", "leased", "running", "waiting_review", "waiting_approval"] } },
    data: {
      status: "paused",
      lockedBy: null,
      lockedUntil: null,
      lastError: reason,
      audit: auditAppend(current?.audit ?? null, { event: "paused", reason }),
    },
  });
}

export async function resumeWorkItem(id: string, organizationId: string) {
  const current = await prisma.workItem.findFirst({ where: { id, organizationId } });
  await prisma.workItem.updateMany({
    where: { id, organizationId, status: { in: ["paused", "waiting_review", "waiting_approval"] } },
    data: {
      status: "queued",
      runAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
      audit: auditAppend(current?.audit ?? null, { event: "resumed" }),
    },
  });
}

export async function cancelWorkItem(id: string, organizationId: string, reason = "cancelled") {
  const current = await prisma.workItem.findFirst({ where: { id, organizationId } });
  await prisma.workItem.updateMany({
    where: { id, organizationId, status: { notIn: ["completed", "cancelled"] } },
    data: {
      status: "cancelled",
      lockedBy: null,
      lockedUntil: null,
      lastError: reason,
      audit: auditAppend(current?.audit ?? null, { event: "cancelled", reason }),
    },
  });
}

export async function recoverExpiredLeases(now = new Date()) {
  const stuck = await prisma.workItem.findMany({
    where: {
      status: { in: ["leased", "running"] },
      lockedUntil: { lt: now },
    },
  });
  for (const item of stuck) {
    if (item.externalEffect === "intent" || item.externalEffect === "uncertain") {
      await prisma.workItem.update({
        where: { id: item.id },
        data: {
          status: "needs_verification",
          lockedBy: null,
          lockedUntil: null,
          externalEffect: "uncertain",
          lastError: "Externe Aktion nach Neustart nicht erneut ausgeführt.",
          audit: auditAppend(item.audit, { event: "needs_verification" }),
        },
      });
      if (item.jobId) {
        await prisma.job.updateMany({
          where: { id: item.jobId, organizationId: item.organizationId, status: { in: ["running", "planning"] } },
          data: {
            status: "paused",
            pauseReason: "Externe Aktion nach Neustart nicht erneut ausgeführt.",
          },
        });
      }
      continue;
    }
    const effect = await prisma.workEffect.findFirst({
      where: { workItemId: item.id, status: { in: ["intent", "uncertain"] } },
    });
    if (effect) {
      await prisma.workEffect.update({ where: { id: effect.id }, data: { status: "uncertain" } });
      await prisma.workItem.update({
        where: { id: item.id },
        data: {
          status: "needs_verification",
          lockedBy: null,
          lockedUntil: null,
          externalEffect: "uncertain",
          lastError: "Externe Aktion ist unbestätigt und wird nicht wiederholt.",
          audit: auditAppend(item.audit, { event: "needs_verification", effectId: effect.id }),
        },
      });
      if (item.jobId) {
        await prisma.job.updateMany({
          where: { id: item.jobId, organizationId: item.organizationId, status: { in: ["running", "planning"] } },
          data: {
            status: "paused",
            pauseReason: "Externe Aktion ist unbestätigt und wird nicht wiederholt.",
          },
        });
      }
      continue;
    }
    const giveUp = item.attempts >= item.maxAttempts;
    await prisma.workItem.update({
      where: { id: item.id },
      data: {
        status: giveUp ? "failed" : "queued",
        runAt: giveUp ? item.runAt : nextRunAt(now, item.attempts),
        lockedBy: null,
        lockedUntil: null,
        lastError: giveUp ? "Lease abgelaufen." : item.lastError,
        audit: auditAppend(item.audit, { event: giveUp ? "lease_failed" : "requeued" }),
      },
    });
  }
  return stuck.length;
}

export async function withExternalEffect<T>(input: {
  organizationId: string;
  workItemId: string;
  idempotencyKey: string;
  effectType: string;
  run: () => Promise<T>;
}): Promise<{ decision: "proceed" | "already_committed" | "needs_verification"; value?: T }> {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.workEffect.findFirst({
    where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
  });
  const decision = decideExternalEffect(existing);
  if (decision !== "proceed") {
    if (decision === "needs_verification") {
      await prisma.workItem.updateMany({
        where: { id: input.workItemId, organizationId: input.organizationId },
        data: { status: "needs_verification", externalEffect: "uncertain", lockedBy: null, lockedUntil: null },
      });
    }
    return { decision };
  }
  try {
    await prisma.workEffect.create({
      data: {
        organizationId: input.organizationId,
        workItemId: input.workItemId,
        idempotencyKey: input.idempotencyKey,
        effectType: input.effectType,
        status: "intent",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.workEffect.findFirst({
        where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      });
      const racedDecision = decideExternalEffect(raced);
      return { decision: racedDecision === "proceed" ? "needs_verification" : racedDecision };
    }
    throw error;
  }
  await prisma.workItem.updateMany({
    where: { id: input.workItemId, organizationId: input.organizationId },
    data: { externalEffect: "intent" },
  });
  try {
    const value = await input.run();
    await prisma.workEffect.updateMany({
      where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      data: { status: "committed", committedAt: new Date(), result: JSON.stringify(value ?? null) },
    });
    await prisma.workItem.updateMany({
      where: { id: input.workItemId, organizationId: input.organizationId },
      data: { externalEffect: "committed" },
    });
    return { decision: "proceed", value };
  } catch (error) {
    await prisma.workEffect.updateMany({
      where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey, status: "intent" },
      data: { status: "uncertain", result: error instanceof Error ? error.message : "uncertain" },
    });
    await prisma.workItem.updateMany({
      where: { id: input.workItemId, organizationId: input.organizationId },
      data: {
        status: "needs_verification",
        externalEffect: "uncertain",
        lockedBy: null,
        lockedUntil: null,
        lastError: "Externe Aktion unbestätigt. Kein erneuter Versuch.",
      },
    });
    return { decision: "needs_verification" };
  }
}
