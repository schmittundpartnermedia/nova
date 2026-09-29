import { runHeadLoop } from "@/agents/master/head";
import { createJob, updateJobStatus } from "@/services/jobs";
import { getVisibleContextWindow } from "@/services/conversation";
import { ensureGedaechtnis } from "@/lib/gedaechtnis/store";
import { bootstrapTools } from "@/services/tools/registry";
import { resolveAIProvider } from "@/providers/ai/registry";
import { publicErrorMessage } from "@/lib/secrets";
import type { ProviderMode } from "@/types/ai";
import type { OrbState } from "@/types";
import { DIALOG_HISTORY_SIZE } from "@/types/conversation";

export type MasterEvent =
  | { type: "status"; orbState: OrbState; statusMessage: string }
  | { type: "provider"; providerMode: ProviderMode; providerId: string; model: string; fallback: boolean }
  | { type: "delta"; delta: string };

export type MasterRunResult = {
  jobId: string;
  status: string;
  orbState: OrbState;
  statusMessage: string;
  reply: string;
  approvalId?: string;
  actionType?: string;
  humanRequired?: string | null;
  mock: boolean;
  providerMode: ProviderMode;
  providerId: string;
  model: string;
  needsFile?: "chatgpt-export";
  replyStored?: boolean;
};

function providerModeOf(input: {
  providerId: string;
  fallback: boolean;
}): ProviderMode {
  if (input.fallback) return "fallback";
  if (input.providerId === "openai") return "openai";
  if (input.providerId === "mock") return "mock";
  return "error";
}

/**
 * Nova-Kopf (Phase 1): Gesprächsverlauf + Dauergedächtnis + Tool-Calling.
 * Keine Regex-Verteilung, kein ActiveWork, keine Spezialagenten.
 */
export async function runMaster(input: {
  organizationId: string;
  userRequest: string;
  conversationId?: string;
  sourceMessageId?: string;
  onEvent?: (event: MasterEvent) => void;
  ownedJobId?: string;
  workItemId?: string;
  signal?: AbortSignal;
}): Promise<MasterRunResult> {
  bootstrapTools();
  ensureGedaechtnis();

  const emit = (event: MasterEvent) => input.onEvent?.(event);
  emit({ type: "status", orbState: "THINKING", statusMessage: "Ich denke nach …" });

  const job = input.ownedJobId
    ? { id: input.ownedJobId }
    : await createJob({
        organizationId: input.organizationId,
        userRequest: input.userRequest,
        goal: "Gespräch mit Gedächtnis",
      });
  if (!input.ownedJobId) {
    await updateJobStatus(input.organizationId, job.id, "running", { startedAt: new Date() });
  }

  try {
    const { provider, decision } = await resolveAIProvider(input.organizationId, "master");
    const providerMode = providerModeOf({
      providerId: decision.providerId,
      fallback: decision.fallback,
    });
    emit({
      type: "provider",
      providerMode,
      providerId: decision.providerId,
      model: decision.model,
      fallback: decision.fallback,
    });

    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (input.conversationId) {
      const window = await getVisibleContextWindow({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        limit: DIALOG_HISTORY_SIZE,
      });
      // Die aktuelle User-Nachricht ist schon in der Conversation – nicht doppelt an den Kopf.
      history = window
        .filter((m) => m.role === "user" || m.role === "assistant")
        .filter((m) => m.id !== input.sourceMessageId)
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
    }

    const head = await runHeadLoop({
      provider,
      model: decision.model,
      history,
      userRequest: input.userRequest,
      context: { organizationId: input.organizationId, jobId: job.id },
      onStatus: (statusMessage) => {
        emit({ type: "status", orbState: "WORKING", statusMessage });
      },
    });

    if (head.reply) {
      emit({ type: "delta", delta: head.reply });
    }

    await updateJobStatus(input.organizationId, job.id, "completed", {
      completedAt: new Date(),
    });

    const mailed = head.toolsExecuted.some((t) => t.name === "mail_senden" && t.executed);
    return {
      jobId: job.id,
      status: head.approvalId ? "waiting_for_approval" : "completed",
      orbState: head.approvalId ? "WAITING_FOR_APPROVAL" : mailed ? "DONE" : "DONE",
      statusMessage: head.approvalId ? "Freigabe erforderlich" : mailed ? "Mail gesendet" : "Fertig",
      reply: head.reply,
      approvalId: head.approvalId,
      actionType: head.actionType,
      mock: decision.providerId === "mock",
      providerMode,
      providerId: head.providerId,
      model: head.model,
    };
  } catch (error) {
    const message = publicErrorMessage(error);
    await updateJobStatus(input.organizationId, job.id, "failed", {
      completedAt: new Date(),
    }).catch(() => undefined);
    emit({ type: "status", orbState: "ERROR", statusMessage: message });
    return {
      jobId: job.id,
      status: "failed",
      orbState: "ERROR",
      statusMessage: message,
      reply: message,
      mock: false,
      providerMode: "error",
      providerId: "error",
      model: "none",
    };
  }
}
