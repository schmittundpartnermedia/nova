import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { createJob } from "@/services/jobs";
import { enqueueWorkItem } from "@/services/worker/queue";
import { draftDevelopmentOrder } from "@/lib/development/brief";
import { describeExistingCapabilities } from "@/services/development/inventory";

export async function commissionDevelopment(input: { organizationId: string; userRequest: string }) {
  assertOrganizationId(input.organizationId);
  const existingCapabilities = describeExistingCapabilities();
  const draft = draftDevelopmentOrder(input.userRequest, existingCapabilities);
  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    goal: draft.goal.slice(0, 240),
  });
  const order = await prisma.developmentOrder.create({
    data: {
      organizationId: input.organizationId,
      jobId: job.id,
      userRequest: input.userRequest,
      goal: draft.goal,
      desiredBehavior: draft.desiredBehavior,
      existingCapabilities,
      gap: draft.gap,
      requirements: draft.requirements,
      constraints: draft.constraints,
      approvalRules: draft.approvalRules,
      acceptance: draft.acceptance,
      status: "planned",
    },
  });
  await enqueueWorkItem({
    organizationId: input.organizationId,
    jobId: job.id,
    kind: "development.run",
    idempotencyKey: `development:${order.id}:0`,
    payload: { orderId: order.id },
  });
  return {
    orderId: order.id,
    jobId: job.id,
    reply:
      "Ich habe daraus einen Entwicklungsauftrag gemacht und gebe ihn an Cursor. Dein Wunsch bleibt erhalten. Du kannst jederzeit fragen, wie weit es ist.",
    statusMessage: "Entwicklungsauftrag liegt bei Cursor.",
  };
}
