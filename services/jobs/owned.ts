import { prisma } from "@/lib/prisma";
import type { MasterEvent, MasterRunResult } from "@/agents/master";
import { appendMessage } from "@/services/conversation";
import { createJob, updateJobStatus } from "@/services/jobs";
import { enqueueWorkItem } from "@/services/worker/queue";
import type { ProviderMode } from "@/types/ai";
import type { OrbState } from "@/types";

export type OwnedKind = "computer.run" | "coding.run" | "knowledge.run" | "planner.run";

type StoredOutcome = {
  status: string;
  orbState: OrbState;
  statusMessage: string;
  reply: string;
  approvalId?: string;
  humanRequired?: string | null;
  providerId: string;
  model: string;
  providerMode?: ProviderMode;
  needsFile?: "chatgpt-export";
};

function parseOutcome(raw: string | null): StoredOutcome | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredOutcome;
    if (!parsed || typeof parsed.reply !== "string" || typeof parsed.status !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function asResult(jobId: string, outcome: StoredOutcome): MasterRunResult {
  return {
    jobId,
    status: outcome.status,
    orbState: outcome.orbState,
    statusMessage: outcome.statusMessage,
    reply: outcome.reply,
    approvalId: outcome.approvalId,
    humanRequired: outcome.humanRequired ?? null,
    mock: false,
    providerMode: outcome.providerMode ?? "fallback",
    providerId: outcome.providerId,
    model: outcome.model,
    needsFile: outcome.needsFile,
    replyStored: true,
  };
}

export async function publishOwnedReply(input: {
  organizationId: string;
  conversationId?: string;
  jobId: string;
  reply: string;
}) {
  const conversationId = input.conversationId?.trim();
  const reply = input.reply.trim();
  if (!conversationId || !reply) return;
  const prior = await prisma.conversationMessage.findFirst({
    where: {
      organizationId: input.organizationId,
      conversationId,
      role: "assistant",
      metadata: { contains: input.jobId },
    },
  });
  if (prior) return;
  await appendMessage({
    organizationId: input.organizationId,
    conversationId,
    role: "assistant",
    content: reply,
    inputMode: "text",
    metadata: { channel: "nova-worker", jobId: input.jobId },
  });
}

export async function finishOwnedJob(input: {
  organizationId: string;
  jobId: string;
  conversationId?: string;
  outcome: StoredOutcome;
}) {
  const waiting = input.outcome.status === "waiting_for_approval" || input.outcome.status === "waiting_for_review" || input.outcome.status === "running";
  await prisma.job.updateMany({
    where: { id: input.jobId, organizationId: input.organizationId },
    data: {
      status: input.outcome.status,
      pauseReason: input.outcome.status === "paused" ? input.outcome.statusMessage : null,
      completedAt: waiting ? null : new Date(),
      resumeState: JSON.stringify(input.outcome),
    },
  });
  await publishOwnedReply({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    jobId: input.jobId,
    reply: input.outcome.reply,
  });
}

function stillRunning(jobId: string, providerId: string): MasterRunResult {
  return {
    jobId,
    status: "running",
    orbState: "WORKING",
    statusMessage: "Läuft weiter",
    reply: "Ich führe den Auftrag weiter. Er hängt nicht an dieser Verbindung.",
    mock: false,
    providerMode: "fallback",
    providerId,
    model: "nova-worker",
    replyStored: false,
  };
}

export async function waitForOwnedJob(input: {
  organizationId: string;
  jobId: string;
  providerId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onEvent?: (event: MasterEvent) => void;
}): Promise<MasterRunResult> {
  const deadline = Date.now() + (input.timeoutMs ?? 50_000);
  while (Date.now() < deadline) {
    if (input.signal?.aborted) return stillRunning(input.jobId, input.providerId);
    const [job, item] = await Promise.all([
      prisma.job.findFirst({ where: { id: input.jobId, organizationId: input.organizationId } }),
      prisma.workItem.findFirst({
        where: { jobId: input.jobId, organizationId: input.organizationId },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (item?.status === "needs_verification") {
      return {
        jobId: input.jobId,
        status: "paused",
        orbState: "ERROR",
        statusMessage: "Nicht bestätigt",
        reply: item.lastError || "Eine externe Aktion ist nicht bestätigt. Ich wiederhole sie nicht.",
        mock: false,
        providerMode: "fallback",
        providerId: input.providerId,
        model: "nova-worker",
        replyStored: false,
      };
    }
    const outcome = parseOutcome(job?.resumeState ?? null);
    if (job && outcome && !["pending", "planning", "running"].includes(job.status)) {
      input.onEvent?.({ type: "delta", delta: outcome.reply });
      return asResult(input.jobId, outcome);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return stillRunning(input.jobId, input.providerId);
}

export async function startOwnedJob(input: {
  organizationId: string;
  userRequest: string;
  conversationId?: string;
  sourceMessageId?: string;
  kind: OwnedKind;
  goal: string;
  projectId?: string;
  onEvent?: (event: MasterEvent) => void;
  signal?: AbortSignal;
}): Promise<MasterRunResult> {
  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    goal: input.goal || input.userRequest,
    projectId: input.projectId,
  });
  await updateJobStatus(input.organizationId, job.id, "running", { startedAt: new Date() });
  await enqueueWorkItem({
    organizationId: input.organizationId,
    jobId: job.id,
    kind: input.kind,
    idempotencyKey: `${input.kind}:${job.id}`,
    payload: {
      userRequest: input.userRequest,
      conversationId: input.conversationId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
    },
  });
  input.onEvent?.({
    type: "status",
    orbState: "WORKING",
    statusMessage: "Der Auftrag liegt beim Worker.",
  });
  return waitForOwnedJob({
    organizationId: input.organizationId,
    jobId: job.id,
    providerId: input.kind,
    signal: input.signal,
    onEvent: input.onEvent,
  });
}

export async function continueOwnedJob(input: {
  organizationId: string;
  jobId: string;
  kind: OwnedKind;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  signal?: AbortSignal;
  onEvent?: (event: MasterEvent) => void;
}): Promise<MasterRunResult> {
  const active = await prisma.workItem.findFirst({
    where: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      kind: input.kind,
      status: { in: ["queued", "leased", "running"] },
    },
  });
  if (!active) {
    await enqueueWorkItem({
      organizationId: input.organizationId,
      jobId: input.jobId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
    });
  }
  await updateJobStatus(input.organizationId, input.jobId, "running");
  return waitForOwnedJob({
    organizationId: input.organizationId,
    jobId: input.jobId,
    providerId: input.kind,
    signal: input.signal,
    onEvent: input.onEvent,
  });
}
