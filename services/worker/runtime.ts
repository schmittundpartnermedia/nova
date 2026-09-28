import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  completeWorkItem,
  failWorkItem,
  keepWorkLease,
  leaseDueWork,
  markWorkRunning,
  recoverExpiredLeases,
  withExternalEffect,
} from "@/services/worker/queue";
import { executeCodingWork, executeComputerWork, executeKnowledgeWork, executePlannerWork } from "@/services/jobs/owned-run";
import { runDevelopmentWork } from "@/services/development/run";
import { pauseAbandonedJobs } from "@/services/jobs/recover";
import { mailSendWorkHandler } from "@/services/mail/send-work";

export type WorkHandler = (item: {
  id: string;
  organizationId: string;
  jobId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}) => Promise<{ ok: boolean; retry?: boolean; note?: string }>;

const handlers = new Map<string, WorkHandler>();

export function registerWorkHandler(kind: string, handler: WorkHandler) {
  handlers.set(kind, handler);
}

registerWorkHandler("system.ping", async () => ({ ok: true, note: "pong" }));

registerWorkHandler("review.wait", async () => ({ ok: true, retry: false, note: "bleibt in Prüfung" }));

registerWorkHandler("development.run", runDevelopmentWork);
registerWorkHandler("computer.run", executeComputerWork);
registerWorkHandler("coding.run", executeCodingWork);
registerWorkHandler("knowledge.run", executeKnowledgeWork);
registerWorkHandler("planner.run", executePlannerWork);
registerWorkHandler("mail.send", mailSendWorkHandler);

export async function tickWorker(workerId: string, now = new Date()) {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await pauseAbandonedJobs(now);
  await recoverExpiredLeases(now);
  const leased = await leaseDueWork(workerId, now);
  for (const item of leased) {
    await markWorkRunning(item.id, item.organizationId, workerId);
    if (item.kind === "review.wait") {
      await prisma.workItem.updateMany({
        where: { id: item.id, organizationId: item.organizationId },
        data: { status: "waiting_review", lockedBy: null, lockedUntil: null },
      });
      continue;
    }
    const handler = handlers.get(item.kind);
    if (!handler) {
      await failWorkItem({
        id: item.id,
        organizationId: item.organizationId,
        error: `Kein Worker-Handler für ${item.kind}.`,
        retry: false,
      });
      continue;
    }
    const release = keepWorkLease(item.id, item.organizationId, workerId);
    try {
      const payload = JSON.parse(item.payload) as Record<string, unknown>;
      const result = await handler({
        id: item.id,
        organizationId: item.organizationId,
        jobId: item.jobId,
        kind: item.kind,
        payload,
        attempts: item.attempts,
      });
      const current = await prisma.workItem.findFirst({
        where: { id: item.id, organizationId: item.organizationId },
        select: { status: true },
      });
      if (current?.status === "needs_verification") continue;
      if (result.ok) await completeWorkItem(item.id, item.organizationId, result.note);
      else {
        await failWorkItem({
          id: item.id,
          organizationId: item.organizationId,
          error: result.note ?? "Worker-Schritt fehlgeschlagen.",
          retry: result.retry !== false,
        });
      }
    } catch (error) {
      await failWorkItem({
        id: item.id,
        organizationId: item.organizationId,
        error: error instanceof Error ? error.message : "Worker-Fehler",
        retry: true,
      });
    } finally {
      release();
    }
  }
  return leased.length;
}

export function writeWorkerHeartbeat(file = path.join(process.cwd(), ".nova", "worker.heartbeat")) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 });
}

export { withExternalEffect };
