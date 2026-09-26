import { runCodingAgent } from "@/agents/coding";
import { runComputerAgent } from "@/agents/computer";
import { runKnowledgeAgent } from "@/agents/knowledge";
import { runMaster } from "@/agents/master";
import { parseComputerPlan } from "@/lib/computer/plan";
import { prisma } from "@/lib/prisma";
import { updateComputerJob } from "@/services/computer/audit";
import { finishOwnedJob } from "@/services/jobs/owned";
import { loadEffectResult, withExternalEffect } from "@/services/worker/queue";
import type { WorkHandler } from "@/services/worker/runtime";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const OPEN_COMPUTER = new Set(["EXECUTING", "INTERRUPTED", "PLANNED", "PREPARED"]);
const DONE_COMPUTER = new Set(["VERIFIED", "EXECUTED", "CANCELLED", "CANCELLED_BY_USER", "FAILED", "WAITING_FOR_HUMAN"]);

export const executeComputerWork: WorkHandler = async (item) => {
  if (!item.jobId) return { ok: false, retry: false, note: "Computerauftrag ohne Job." };
  const conversationId = text(item.payload.conversationId) || undefined;
  const approvalToken = text(item.payload.approvalToken) || undefined;
  const userRequest = text(item.payload.userRequest);
  const explicitResume = Boolean(approvalToken) || userRequest === "mach weiter";
  const existing = await prisma.computerJob.findFirst({
    where: { organizationId: item.organizationId, jobId: item.jobId },
    orderBy: { startedAt: "desc" },
  });

  const continueDone = explicitResume && (existing?.status === "FAILED" || existing?.status === "WAITING_FOR_HUMAN");
  if (existing && DONE_COMPUTER.has(existing.status) && !continueDone) {
    const stored = await prisma.job.findFirst({
      where: { id: item.jobId, organizationId: item.organizationId },
      select: { resumeState: true, status: true },
    });
    if (stored?.resumeState && stored.status !== "running") return { ok: true, note: existing.status };
    await finishOwnedJob({
      organizationId: item.organizationId,
      jobId: item.jobId,
      conversationId,
      outcome: {
        status: existing.status === "FAILED" ? "failed" : existing.status === "CANCELLED" || existing.status === "CANCELLED_BY_USER" ? "cancelled" : "completed",
        orbState: existing.status === "FAILED" ? "ERROR" : "DONE",
        statusMessage: existing.status,
        reply: existing.error || "Der Computerauftrag ist bereits abgeschlossen.",
        providerId: "computer",
        model: "nova-desktop",
      },
    });
    return { ok: true, note: existing.status };
  }

  if (existing?.status === "WAITING_FOR_APPROVAL" && !approvalToken) {
    return { ok: true, note: "waiting_for_approval" };
  }

  const resume =
    Boolean(approvalToken) ||
    continueDone ||
    Boolean(existing && (OPEN_COMPUTER.has(existing.status) || existing.status === "WAITING_FOR_APPROVAL"));
  if (existing && OPEN_COMPUTER.has(existing.status) && existing.status !== "INTERRUPTED") {
    const plan = parseComputerPlan(existing.plan);
    if (plan && plan.steps.length > 0 && plan.cursor >= plan.steps.length) {
      await updateComputerJob({
        organizationId: item.organizationId,
        id: existing.id,
        status: "VERIFIED",
        finished: true,
      });
      await finishOwnedJob({
        organizationId: item.organizationId,
        jobId: item.jobId,
        conversationId,
        outcome: {
          status: "completed",
          orbState: "DONE",
          statusMessage: "Geprüft",
          reply: "Der Computerauftrag war schon ausgeführt. Ich habe ihn nicht noch einmal gestartet.",
          providerId: "computer",
          model: "nova-desktop",
        },
      });
      return { ok: true, note: "already-finished" };
    }
    await updateComputerJob({
      organizationId: item.organizationId,
      id: existing.id,
      status: "INTERRUPTED",
      error: "Der Prozess wurde unterbrochen. Ich setze am letzten Schritt fort.",
    });
  }

  const result = await runComputerAgent({
    organizationId: item.organizationId,
    jobId: item.jobId,
    userRequest: resume ? "mach weiter" : userRequest,
    approvalToken,
    workItemId: item.id,
  });
  const waiting = result.status === "WAITING_FOR_APPROVAL" || result.status === "WAITING_FOR_HUMAN";
  const cancelled = result.status === "CANCELLED" || result.status === "CANCELLED_BY_USER";
  const unconfirmed = result.statusMessage === "Nicht bestätigt";
  const status = unconfirmed
    ? "paused"
    : waiting
      ? "waiting_for_approval"
      : cancelled
        ? "cancelled"
        : result.status === "FAILED" || result.status === "INTERRUPTED"
          ? "failed"
          : "completed";
  await finishOwnedJob({
    organizationId: item.organizationId,
    jobId: item.jobId,
    conversationId,
    outcome: {
      status,
      orbState: waiting ? "WAITING_FOR_APPROVAL" : status === "completed" ? "DONE" : "ERROR",
      statusMessage: result.statusMessage,
      reply: result.reply,
      approvalId: result.approvalId,
      humanRequired: result.humanRequired ?? null,
      providerId: "computer",
      model: "nova-desktop",
    },
  });
  return { ok: true, note: result.status };
};

export const executeCodingWork: WorkHandler = async (item) => {
  if (!item.jobId) return { ok: false, retry: false, note: "Coding-Auftrag ohne Job." };
  const conversationId = text(item.payload.conversationId) || undefined;
  const userRequest = text(item.payload.userRequest);
  const key = `coding:${item.jobId}`;
  const effect = await withExternalEffect({
    organizationId: item.organizationId,
    workItemId: item.id,
    idempotencyKey: key,
    effectType: "cursor",
    run: () =>
      runCodingAgent({
        organizationId: item.organizationId,
        jobId: item.jobId ?? undefined,
        userRequest,
      }),
  });
  if (effect.decision === "needs_verification") {
    await finishOwnedJob({
      organizationId: item.organizationId,
      jobId: item.jobId,
      conversationId,
      outcome: {
        status: "paused",
        orbState: "ERROR",
        statusMessage: "Nicht bestätigt",
        reply: "Der Cursor-Lauf ist nicht bestätigt. Ich starte ihn nicht noch einmal.",
        providerId: "coding",
        model: "cursor-agent",
      },
    });
    return { ok: true, note: "needs_verification" };
  }
  const result =
    effect.decision === "already_committed"
      ? await loadEffectResult<Awaited<ReturnType<typeof runCodingAgent>>>(item.organizationId, key)
      : effect.value;
  if (!result) {
    await finishOwnedJob({
      organizationId: item.organizationId,
      jobId: item.jobId,
      conversationId,
      outcome: {
        status: "paused",
        orbState: "ERROR",
        statusMessage: "Nicht bestätigt",
        reply: "Das Cursor-Ergebnis fehlt. Ich starte den Lauf nicht noch einmal.",
        providerId: "coding",
        model: "cursor-agent",
      },
    });
    return { ok: true, note: "missing" };
  }
  const status =
    result.status === "WAITING_FOR_APPROVAL"
      ? "waiting_for_approval"
      : result.status === "CANCELLED_BY_USER"
        ? "cancelled"
        : result.status === "FAILED" || result.status === "UNVERIFIED"
          ? "failed"
          : "completed";
  await finishOwnedJob({
    organizationId: item.organizationId,
    jobId: item.jobId,
    conversationId,
    outcome: {
      status,
      orbState: status === "waiting_for_approval" ? "WAITING_FOR_APPROVAL" : status === "failed" ? "ERROR" : "DONE",
      statusMessage: result.statusMessage,
      reply: result.reply,
      approvalId: result.approvalId,
      providerId: "coding",
      model: "cursor-agent",
    },
  });
  return { ok: true, note: result.status };
};

export const executeKnowledgeWork: WorkHandler = async (item) => {
  if (!item.jobId) return { ok: false, retry: false, note: "Wissensauftrag ohne Job." };
  const conversationId = text(item.payload.conversationId) || undefined;
  const userRequest = text(item.payload.userRequest);
  const key = `knowledge:${item.jobId}`;
  const effect = await withExternalEffect({
    organizationId: item.organizationId,
    workItemId: item.id,
    idempotencyKey: key,
    effectType: "knowledge-import",
    run: () =>
      runKnowledgeAgent({
        organizationId: item.organizationId,
        jobId: item.jobId ?? undefined,
        userRequest,
      }),
  });
  if (effect.decision === "needs_verification") {
    await finishOwnedJob({
      organizationId: item.organizationId,
      jobId: item.jobId,
      conversationId,
      outcome: {
        status: "paused",
        orbState: "ERROR",
        statusMessage: "Nicht bestätigt",
        reply: "Der Import ist nicht bestätigt. Ich starte ihn nicht noch einmal.",
        providerId: "knowledge",
        model: "nova-knowledge",
      },
    });
    return { ok: true, note: "needs_verification" };
  }
  const result =
    effect.decision === "already_committed"
      ? await loadEffectResult<Awaited<ReturnType<typeof runKnowledgeAgent>>>(item.organizationId, key)
      : effect.value;
  if (!result) {
    await finishOwnedJob({
      organizationId: item.organizationId,
      jobId: item.jobId,
      conversationId,
      outcome: {
        status: "paused",
        orbState: "ERROR",
        statusMessage: "Nicht bestätigt",
        reply: "Das Importergebnis fehlt. Ich starte ihn nicht noch einmal.",
        providerId: "knowledge",
        model: "nova-knowledge",
      },
    });
    return { ok: true, note: "missing" };
  }
  const status = result.cancelled ? "cancelled" : result.ok ? "completed" : "failed";
  await finishOwnedJob({
    organizationId: item.organizationId,
    jobId: item.jobId,
    conversationId,
    outcome: {
      status,
      orbState: status === "completed" ? "DONE" : "ERROR",
      statusMessage: result.statusMessage,
      reply: result.reply,
      providerId: "knowledge",
      model: "nova-knowledge",
      needsFile: result.needsFile,
    },
  });
  return { ok: true, note: status };
};

export const executePlannerWork: WorkHandler = async (item) => {
  if (!item.jobId) return { ok: false, retry: false, note: "Plan ohne Job." };
  const result = await runMaster({
    organizationId: item.organizationId,
    userRequest: text(item.payload.userRequest),
    conversationId: text(item.payload.conversationId) || undefined,
    sourceMessageId: text(item.payload.sourceMessageId) || undefined,
    ownedJobId: item.jobId,
    workItemId: item.id,
  });
  await finishOwnedJob({
    organizationId: item.organizationId,
    jobId: item.jobId,
    conversationId: text(item.payload.conversationId) || undefined,
    outcome: {
      status: result.status,
      orbState: result.orbState,
      statusMessage: result.statusMessage,
      reply: result.reply,
      approvalId: result.approvalId,
      humanRequired: result.humanRequired ?? null,
      providerId: result.providerId,
      model: result.model,
      providerMode: result.providerMode,
      needsFile: result.needsFile,
    },
  });
  return { ok: true, note: result.status };
};
