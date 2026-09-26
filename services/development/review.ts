import { prisma } from "@/lib/prisma";
import { enqueueWorkItem } from "@/services/worker/queue";
import { setJobExecution } from "@/services/jobs";
import type { ReviewCommand } from "@/lib/review/intent";

function readHistory(raw: string): Array<{ iteration: number; status: string; summary: string }> {
  try {
    const parsed = JSON.parse(raw) as Array<{ iteration: number; status: string; summary: string }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function applyDevelopmentReview(input: {
  organizationId: string;
  jobId: string;
  command: ReviewCommand;
}) {
  const order = await prisma.developmentOrder.findFirst({
    where: { organizationId: input.organizationId, jobId: input.jobId, status: "waiting_review" },
  });
  if (!order) return null;

  if (input.command.kind === "approve" || input.command.kind === "continue") {
    await prisma.developmentOrder.update({
      where: { id: order.id },
      data: { status: "completed", resultSummary: "Von Joachim abgenommen." },
    });
    await setJobExecution({
      organizationId: input.organizationId,
      jobId: input.jobId,
      status: "completed",
      completedAt: new Date(),
      pauseReason: null,
    });
    const goal = order.goal.replace(/^[„“”"«»']+|[„“”"«»']+$/g, "").trim();
    return {
      jobId: input.jobId,
      status: "completed" as const,
      orbState: "DONE" as const,
      statusMessage: "Entwicklung abgenommen.",
      reply: `Abgenommen. Der Entwicklungsauftrag ist abgeschlossen: ${goal}`,
    };
  }

  if (input.command.kind === "changes") {
    const history = readHistory(order.history);
    history.push({ iteration: order.iteration, status: "waiting_review", summary: input.command.instruction });
    await prisma.developmentOrder.update({
      where: { id: order.id },
      data: {
        status: "planned",
        iteration: order.iteration + 1,
        history: JSON.stringify(history),
        resultSummary: input.command.instruction,
      },
    });
    await enqueueWorkItem({
      organizationId: input.organizationId,
      jobId: input.jobId,
      kind: "development.run",
      idempotencyKey: `development:${order.id}:${order.iteration + 1}:review`,
      payload: { orderId: order.id },
    });
    await setJobExecution({
      organizationId: input.organizationId,
      jobId: input.jobId,
      status: "running",
      pauseReason: null,
    });
    return {
      jobId: input.jobId,
      status: "running" as const,
      orbState: "WORKING" as const,
      statusMessage: "Ich gebe die Änderung an Cursor.",
      reply: `Dein ursprünglicher Wunsch bleibt. Ich gebe Cursor diese Änderung: ${input.command.instruction}`,
    };
  }

  await prisma.developmentOrder.update({
    where: { id: order.id },
    data: { status: "failed", resultSummary: "Abnahme abgebrochen." },
  });
  return null;
}
