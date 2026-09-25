import { getAgent } from "@/agents/registry";
import { bootstrapAgents } from "@/agents/bootstrap";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { searchMail } from "@/services/mail/search";
import { auditMail } from "@/services/mail/audit";
import { createApprovalRequest } from "@/services/approvals";

export async function prepareMailDraft(input: {
  organizationId: string;
  userRequest: string;
  jobId?: string;
  projectId?: string;
}) {
  assertOrganizationId(input.organizationId);
  bootstrapAgents();
  const hits = await searchMail({ organizationId: input.organizationId, query: input.userRequest, limit: 3 });
  const latest = hits[0];
  const thread = latest
    ? await prisma.mailThread.findFirst({
        where: { id: latest.threadId, organizationId: input.organizationId },
        include: { messages: { orderBy: { receivedAt: "asc" }, take: 8 } },
      })
    : null;
  const agent = getAgent("communication");
  if (!agent) throw new Error("Communication Agent fehlt.");
  const result = await agent.run(
    {
      mode: "reply",
      brief: input.userRequest,
      mailThreadId: thread?.id,
      mailAccountId: latest?.accountId,
      to: latest?.fromAddress,
      subject: latest ? `Re: ${latest.subject.replace(/^re:\s*/i, "")}` : "Antwort",
      inReplyTo: latest?.internetMessageId ?? undefined,
      threadContext: thread
        ? thread.messages.map((item) => `${item.fromName ?? item.fromAddress}: ${item.normalizedText}`).join("\n---\n")
        : "",
      projectName: input.userRequest,
    },
    {
      organizationId: input.organizationId,
      jobId: input.jobId ?? "mail-draft",
      userRequest: input.userRequest,
      goal: "Mailentwurf",
      projectId: input.projectId,
    },
  );
  const communicationId = ((result.data.communicationIds as string[]) ?? [])[0];
  if (!communicationId) {
    return { ok: false, reply: "Ich konnte keinen Entwurf anlegen.", communicationId: null as string | null };
  }
  const draft = await prisma.communication.findFirst({
    where: { id: communicationId, organizationId: input.organizationId },
  });
  if (draft) {
    await prisma.communication.update({
      where: { id: draft.id },
      data: { deliveryStatus: "WAITING_FOR_APPROVAL" },
    });
    await auditMail({
      organizationId: input.organizationId,
      action: "DRAFT_CREATED",
      threadId: draft.mailThreadId ?? undefined,
      status: "prepared",
      detail: draft.subject,
      jobId: input.jobId,
    });
    const approval = await createApprovalRequest({
      organizationId: input.organizationId,
      jobId: input.jobId,
      actionType: "mail.send",
      description: `Antwort ist vorbereitet:\n\n${draft.body.slice(0, 700)}\n\nSenden?`,
      payload: { communicationIds: [draft.id] },
    });
    await auditMail({
      organizationId: input.organizationId,
      action: "APPROVAL_REQUESTED",
      status: "prepared",
      detail: draft.subject,
      jobId: input.jobId,
    });
    return {
      ok: true,
      communicationId: draft.id,
      approvalId: approval.id,
      reply: `Antwort ist vorbereitet:\n\n${draft.body.slice(0, 700)}\n\nSenden?`,
    };
  }
  return { ok: false, reply: result.summary, communicationId: null as string | null };
}
