import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { formatDevelopmentStatusReply, summarizeCursorGoal } from "@/lib/development/status-text";

const ACTIVE_CURSOR = ["PENDING", "STARTING", "RUNNING", "WAITING", "VERIFYING", "NEEDS_FIX", "WAITING_FOR_APPROVAL"];

export async function explainDevelopment(organizationId: string, userRequest: string) {
  assertOrganizationId(organizationId);
  const [orders, sessions] = await Promise.all([
    prisma.developmentOrder.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.cursorSession.findMany({
      where: { organizationId, status: { in: ACTIVE_CURSOR } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);

  return formatDevelopmentStatusReply({
    userRequest,
    orders: orders.map((order) => ({
      status: order.status,
      goal: order.goal,
      iteration: order.iteration,
      maxIterations: order.maxIterations,
      resultSummary: order.resultSummary,
    })),
    cursorWork: sessions.map((session) => ({
      status: session.status,
      projectPath: session.projectPath,
      goal: summarizeCursorGoal(session.initialPrompt),
    })),
  });
}
