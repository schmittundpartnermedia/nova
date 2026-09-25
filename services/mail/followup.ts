import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { auditMail } from "@/services/mail/audit";

export async function createMailFollowUp(input: {
  organizationId: string;
  threadId: string;
  expectedFrom?: string;
  dueAt: Date;
  reason: string;
}) {
  assertOrganizationId(input.organizationId);
  const thread = await prisma.mailThread.findFirst({
    where: { id: input.threadId, organizationId: input.organizationId },
  });
  if (!thread) throw new Error("Thread gehört nicht zur Organization.");
  const row = await prisma.mailFollowUp.create({
    data: {
      organizationId: input.organizationId,
      threadId: input.threadId,
      expectedFrom: input.expectedFrom,
      dueAt: input.dueAt,
      reason: input.reason,
      status: "open",
    },
  });
  await auditMail({
    organizationId: input.organizationId,
    action: "FOLLOWUP_CREATED",
    threadId: input.threadId,
    status: "prepared",
    detail: input.reason,
  });
  return row;
}

export async function completeFollowUpsForInbound(input: { organizationId: string; threadId: string; from: string }) {
  assertOrganizationId(input.organizationId);
  const open = await prisma.mailFollowUp.findMany({
    where: { organizationId: input.organizationId, threadId: input.threadId, status: "open" },
  });
  for (const item of open) {
    if (item.expectedFrom && item.expectedFrom.toLowerCase() !== input.from.toLowerCase()) continue;
    await prisma.mailFollowUp.update({ where: { id: item.id }, data: { status: "completed" } });
    await auditMail({
      organizationId: input.organizationId,
      action: "FOLLOWUP_COMPLETED",
      threadId: input.threadId,
      status: "completed",
      detail: item.reason,
    });
  }
}

export async function listDueFollowUps(organizationId: string, now = new Date()) {
  assertOrganizationId(organizationId);
  return prisma.mailFollowUp.findMany({
    where: { organizationId, status: "open", dueAt: { lte: now } },
    include: { thread: true },
    orderBy: { dueAt: "asc" },
    take: 12,
  });
}
