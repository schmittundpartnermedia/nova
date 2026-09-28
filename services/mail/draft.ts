import { getAgent } from "@/agents/registry";
import { bootstrapAgents } from "@/agents/bootstrap";
import { prisma } from "@/lib/prisma";
import { nextDraftBody } from "@/lib/mail/revise";
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
  const revises =
    /(?:^|[^\p{L}])(?:änder\w*|aender\w*|korrigier\w*|ergänz\w*|erganz\w*|überarbeit\w*|ueberarbeit\w*)\b/iu.test(
      ` ${input.userRequest}`,
    ) && /\bentwurf\b/i.test(input.userRequest);
  if (revises) {
    const open = await prisma.communication.findFirst({
      where: {
        organizationId: input.organizationId,
        channel: "email",
        direction: "outbound",
        sentAt: null,
        status: { notIn: ["sent", "executed"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!open) {
      return {
        ok: false,
        reply: "Es liegt kein offener Entwurf vor. Nenne Empfänger und Text, dann lege ich einen an. Eine andere Mail nehme ich dafür nicht.",
        communicationId: null as string | null,
      };
    }
    const next = nextDraftBody(open.body, input.userRequest);
    if (!next.changed) {
      return {
        ok: true,
        communicationId: open.id,
        reply: `Das ist weiterhin dieser Entwurf, Empfänger und Betreff bleiben.\nBetreff: ${open.subject}\n\n${open.body.slice(0, 700)}\n\nWas soll ich daran ändern?`,
      };
    }
    const draft = await prisma.communication.update({
      where: { id: open.id },
      data: { body: next.body, deliveryStatus: "WAITING_FOR_APPROVAL" },
    });
    const shown = `Ich habe denselben Entwurf geändert.\nBetreff: ${draft.subject}\n\n${draft.body.slice(0, 700)}\n\nSenden?`;
    const approval = await createApprovalRequest({
      organizationId: input.organizationId,
      jobId: input.jobId,
      actionType: "mail.send",
      description: shown,
      payload: { communicationIds: [draft.id] },
    });
    return { ok: true, communicationId: draft.id, approvalId: approval.id, reply: shown };
  }
  const explicitTo = input.userRequest.match(/\b(?:an|empfänger|empfaenger)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1] ?? null;
  const explicitFrom = input.userRequest.match(/\b(?:von|absender)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1] ?? null;
  const explicitSubject = input.userRequest.match(/\bBetreff\s*[:\-]?\s*([^\n.]+)/i)?.[1]?.trim() || null;
  if (explicitTo) {
    const defaultAccount = await prisma.mailAccount.findFirst({
      where: { organizationId: input.organizationId, provider: "apple-mail", status: "connected" },
      orderBy: { updatedAt: "desc" },
    });
    const account = explicitFrom
      ? await prisma.mailAccount.findFirst({
          where: {
            organizationId: input.organizationId,
            emailAddress: explicitFrom,
            status: "connected",
          },
        })
      : defaultAccount;
    if (explicitFrom && !account) {
      return {
        ok: false,
        reply: `Das Absenderkonto ${explicitFrom} ist nicht verbunden. Es wurde nichts vorbereitet und nichts versendet.`,
        communicationId: null as string | null,
      };
    }
    if (!account) {
      return {
        ok: false,
        reply:
          "Kein Apple-Mail-Konto ist verbunden. Bitte einmal „Apple Mail verbinden“ in NOVA freigeben (Systemeinstellungen → Datenschutz → Automation → Mail), danach erneut den Entwurf anfordern. Es wurde nichts versendet.",
        communicationId: null as string | null,
      };
    }
    const agent = getAgent("communication");
    if (!agent) throw new Error("Communication Agent fehlt.");
    const subject = explicitSubject || "NOVA Testmail";
    const literalBody = `An: ${explicitTo}\n\nGuten Tag,\n\ndies ist eine NOVA-Testmail und kein echter Vorgang.\n\nFreundliche Grüße\nJoachim`;
    const result = await agent.run(
      {
        mode: "reply",
        brief: input.userRequest,
        literalBody,
        mailAccountId: account?.id,
        to: explicitTo,
        subject,
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
    if (!draft) return { ok: false, reply: result.summary, communicationId: null as string | null };
    await prisma.communication.update({
      where: { id: draft.id },
      data: { deliveryStatus: "WAITING_FOR_APPROVAL", mailAccountId: account?.id ?? draft.mailAccountId, subject },
    });
    const sender = account?.emailAddress ?? "kein festes Absenderkonto";
    const shown = `Neue Mail ist vorbereitet.\nAbsender: ${sender}\nEmpfänger: ${explicitTo}\nBetreff: ${subject}\n\n${draft.body.slice(0, 700)}\n\nSenden?`;
    await auditMail({
      organizationId: input.organizationId,
      action: "DRAFT_CREATED",
      status: "prepared",
      detail: subject,
      jobId: input.jobId,
    });
    const approval = await createApprovalRequest({
      organizationId: input.organizationId,
      jobId: input.jobId,
      actionType: "mail.send",
      description: shown,
      payload: { communicationIds: [draft.id] },
    });
    await auditMail({
      organizationId: input.organizationId,
      action: "APPROVAL_REQUESTED",
      status: "prepared",
      detail: subject,
      jobId: input.jobId,
    });
    return { ok: true, communicationId: draft.id, approvalId: approval.id, reply: shown };
  }
  const named = input.userRequest.match(/\b(?:an|von)\s+([A-ZÄÖÜ][\wäöüÄÖÜß.-]+)/);
  const hits = named
    ? await searchMail({ organizationId: input.organizationId, query: named[1], limit: 3 })
    : [];
  const fallback = hits[0]
    ? hits
    : await prisma.mailMessage.findMany({
        where: {
          organizationId: input.organizationId,
          classification: { in: ["REPLY_REQUIRED", "ACTION_REQUIRED", "IMPORTANT"] },
        },
        orderBy: { receivedAt: "desc" },
        take: 1,
        include: { thread: true },
      });
  const latest = (hits[0] ?? fallback[0]) as (typeof hits)[number] | undefined;
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
