import { prisma } from "@/lib/prisma";
import { runCodingAgent } from "@/agents/coding";
import { buildCursorCommission, draftDevelopmentOrder, mapCodingOutcome } from "@/lib/development/brief";
import { enqueueWorkItem, withExternalEffect } from "@/services/worker/queue";
import { setJobExecution } from "@/services/jobs";
import { fileArtifact } from "@/services/artifacts";

type HistoryEntry = { iteration: number; status: string; summary: string };

function readHistory(raw: string): HistoryEntry[] {
  try {
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function runDevelopmentWork(item: {
  id: string;
  organizationId: string;
  jobId: string | null;
  payload: Record<string, unknown>;
}) {
  const orderId = String(item.payload.orderId ?? "");
  const order = await prisma.developmentOrder.findFirst({
    where: { id: orderId, organizationId: item.organizationId },
  });
  if (!order) return { ok: false, retry: false, note: "Entwicklungsauftrag fehlt." };
  if (order.status === "completed" || order.status === "waiting_review" || order.status === "blocked" || order.status === "failed") {
    return { ok: true, note: order.status };
  }

  const effect = await withExternalEffect({
    organizationId: item.organizationId,
    workItemId: item.id,
    idempotencyKey: `development-cursor:${order.id}:${order.iteration}`,
    effectType: "cursor",
    run: async () => {
      const history = readHistory(order.history);
      const previous = history.at(-1)?.summary;
      const draft = draftDevelopmentOrder(order.userRequest, order.existingCapabilities);
      const brief = buildCursorCommission({
        userRequest: order.userRequest,
        draft,
        existingCapabilities: order.existingCapabilities,
        workspacePath: order.workspacePath,
        previousFinding: previous,
      });
      await prisma.developmentOrder.update({
        where: { id: order.id },
        data: { status: "developing" },
      });
      if (order.jobId) {
        await setJobExecution({
          organizationId: item.organizationId,
          jobId: order.jobId,
          status: "running",
          pauseReason: null,
        });
      }
      return runCodingAgent({
        organizationId: item.organizationId,
        jobId: order.jobId ?? undefined,
        userRequest: brief,
        workspacePath: order.workspacePath ?? undefined,
      });
    },
  });

  if (effect.decision === "needs_verification") {
    await prisma.developmentOrder.update({
      where: { id: order.id },
      data: {
        status: "blocked",
        resultSummary: "Der Cursor-Lauf ist nicht bestätigt. Ich starte ihn nicht noch einmal.",
      },
    });
    return { ok: true, note: "blocked" };
  }

  let result = effect.value;
  if (effect.decision === "already_committed") {
    const stored = await prisma.workEffect.findFirst({
      where: {
        organizationId: item.organizationId,
        idempotencyKey: `development-cursor:${order.id}:${order.iteration}`,
      },
    });
    if (stored?.result) {
      result = JSON.parse(stored.result) as typeof result;
    }
  }
  if (!result) {
    await prisma.developmentOrder.update({
      where: { id: order.id },
      data: { status: "blocked", resultSummary: "Cursor-Ergebnis fehlt." },
    });
    return { ok: true, note: "blocked" };
  }

  const history = readHistory(order.history);
  history.push({ iteration: order.iteration, status: result.status, summary: result.summary });
  const next = mapCodingOutcome({
    verified: result.verified,
    status: result.status,
    summary: result.summary,
    iteration: order.iteration,
    maxIterations: order.maxIterations,
  });

  if (next === "developing") {
    await prisma.developmentOrder.update({
      where: { id: order.id },
      data: {
        status: "planned",
        iteration: order.iteration + 1,
        history: JSON.stringify(history),
        resultSummary: result.summary,
        cursorSessionId: result.sessionId ?? order.cursorSessionId,
        workspacePath: result.projectPath ?? order.workspacePath,
      },
    });
    await enqueueWorkItem({
      organizationId: item.organizationId,
      jobId: order.jobId ?? undefined,
      kind: "development.run",
      idempotencyKey: `development:${order.id}:${order.iteration + 1}`,
      payload: { orderId: order.id },
    });
    return { ok: true, note: "nächste Iteration" };
  }

  let summary = result.summary;
  if (next === "waiting_review" && order.jobId) {
    const filed = await fileArtifact({
      organizationId: item.organizationId,
      jobId: order.jobId,
      type: "CODING_BRIEF",
      title: "Entwicklungsabnahme",
      body: `${order.userRequest}\n\n${result.reply}`,
      source: "development",
      openReview: true,
    });
    summary = filed.windowOpened
      ? "Die Funktion ist technisch geprüft. Ich öffne sie dir zur Abnahme."
      : `Die Funktion ist technisch geprüft. ${filed.message}`;
    await setJobExecution({
      organizationId: item.organizationId,
      jobId: order.jobId,
      status: "waiting_for_review",
      pauseReason: "development_review",
    });
  }

  await prisma.developmentOrder.update({
    where: { id: order.id },
    data: {
      status: next,
      history: JSON.stringify(history),
      resultSummary: summary,
      cursorSessionId: result.sessionId ?? order.cursorSessionId,
      workspacePath: result.projectPath ?? order.workspacePath,
    },
  });
  return { ok: true, note: next };
}
