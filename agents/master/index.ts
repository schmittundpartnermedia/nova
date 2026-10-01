import { runHeadLoop, verlaufsInhalt } from "@/agents/master/head";
import { createJob, updateJobStatus } from "@/services/jobs";
import { getVisibleContextWindow } from "@/services/conversation";
import { ensureGedaechtnis } from "@/lib/gedaechtnis/store";
import { bootstrapTools } from "@/services/tools/registry";
import { resolveHead } from "@/providers/ai/head";
import { ImapPostfach } from "@/connectors/mail/imap";
import { publicErrorMessage } from "@/lib/secrets";
import type { ProviderMode } from "@/types/ai";
import type { OrbState } from "@/types";
import { schliesseAbgelaufeneFreigaben } from "@/services/approvals";
import { DIALOG_HISTORY_SIZE } from "@/types/conversation";

const postfach = new ImapPostfach();

export type MasterEvent =
  | { type: "status"; orbState: OrbState; statusMessage: string }
  | { type: "provider"; providerMode: ProviderMode; providerId: string; model: string }
  | { type: "delta"; delta: string }
  | { type: "ansage"; text: string };

export type MasterRunResult = {
  jobId: string;
  status: string;
  orbState: OrbState;
  statusMessage: string;
  reply: string;
  /** Werkzeugprotokoll dieser Antwort; wird mit der Assistenten-Nachricht gespeichert. */
  werkzeugNotiz?: string;
  providerMode: ProviderMode;
  providerId: string;
  model: string;
};

/**
 * Nova-Kopf: Gesprächsverlauf + Dauergedächtnis + Tool-Calling.
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
  await schliesseAbgelaufeneFreigaben(input.organizationId);

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
    const { provider, model } = await resolveHead(input.organizationId);
    emit({ type: "provider", providerMode: "openai", providerId: provider.id, model });

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
          content:
            m.role === "assistant"
              ? verlaufsInhalt(m.content, typeof m.metadata?.werkzeuge === "string" ? m.metadata.werkzeuge : undefined)
              : m.content,
        }));
    }

    const head = await runHeadLoop({
      provider,
      model,
      history,
      userRequest: input.userRequest,
      context: { organizationId: input.organizationId, jobId: job.id, postfach },
      onAnsage: (text) => emit({ type: "ansage", text }),
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

    const gesendet = head.toolsExecuted.some((tool) => tool.name === "mail_senden" && tool.executed);
    return {
      jobId: job.id,
      status: "completed",
      orbState: "DONE",
      statusMessage: gesendet ? "Mail gesendet" : "Fertig",
      reply: head.reply,
      werkzeugNotiz: head.werkzeugNotiz,
      providerMode: "openai",
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
      providerMode: "error",
      providerId: "error",
      model: "none",
    };
  }
}
