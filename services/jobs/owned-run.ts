import { runCodingAgent } from "@/agents/coding";
import { runKnowledgeAgent } from "@/agents/knowledge";
import { runMaster } from "@/agents/master";
import { finishOwnedJob } from "@/services/jobs/owned";
import { loadEffectResult, withExternalEffect } from "@/services/worker/queue";
import type { WorkHandler } from "@/services/worker/runtime";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Computer-Agent entfernt (Phase 1). Alte Queue-Einträge enden ehrlich. */
export const executeComputerWork: WorkHandler = async (item) => {
  if (!item.jobId) return { ok: false, retry: false, note: "Computerauftrag ohne Job." };
  await finishOwnedJob({
    organizationId: item.organizationId,
    jobId: item.jobId,
    conversationId: text(item.payload.conversationId) || undefined,
    outcome: {
      status: "cancelled",
      orbState: "ERROR",
      statusMessage: "Computersteuerung entfernt",
      reply: "Die Klick-/Computer-Steuerung ist entfernt. Dieser Auftrag wird nicht ausgeführt.",
      providerId: "computer",
      model: "removed",
    },
  });
  return { ok: true, note: "removed" };
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
