import { getAgent } from "@/agents/registry";
import { bootstrapAgents } from "@/agents/bootstrap";
import { prisma } from "@/lib/prisma";
import { nextDraftBody } from "@/lib/mail/revise";
import {
  extractAccountChoice,
  formatAccountQuestion,
  formatDraftForApproval,
  looksLikeAccountAffirmative,
  looksLikeAccountPick,
  looksLikePendingMailFollowUp,
  parseMailDraftSpec,
  stripDraftFooter,
} from "@/lib/mail/draft-spec";
import { detectMailIntent } from "@/lib/mail/intent";
import { assertOrganizationId } from "@/services/tenant";
import { searchMail } from "@/services/mail/search";
import { auditMail } from "@/services/mail/audit";
import { createApprovalRequest } from "@/services/approvals";
import { findMatchingPolicy, standingApprovalAllows } from "@/services/approvals";
import {
  clearPendingMailDraft,
  loadPendingMailDraft,
  preferredMailAccount,
  savePendingMailDraft,
  updatePendingMailDraft,
} from "@/services/mail/pending-draft";
import { filterSteerableMailAccounts, isSteerableMailAddress } from "@/lib/mail/steerable";

function parsePolicyConditions(raw: string): {
  allowedRecipientDomains: string[];
} {
  try {
    const parsed = JSON.parse(raw || "{}") as { allowedRecipientDomains?: unknown };
    return {
      allowedRecipientDomains: Array.isArray(parsed.allowedRecipientDomains)
        ? parsed.allowedRecipientDomains.map((item) => String(item).toLowerCase())
        : [],
    };
  } catch {
    return { allowedRecipientDomains: [] };
  }
}

function domainOf(email?: string): string | undefined {
  if (!email?.includes("@")) return undefined;
  return email.split("@").pop()?.toLowerCase();
}

/**
 * Prüft Dauerfreigabe für Entwurf – ohne Tageslimit zu verbrauchen.
 * Verbrauch erst beim echten Versand (authorizeExternalAction / mail_senden).
 */
async function requestMailSendApproval(input: {
  organizationId: string;
  jobId?: string;
  description: string;
  payload: Record<string, unknown>;
  recipient?: string;
}): Promise<{ approvalId: string; viaStanding: boolean; reason: string }> {
  const domain = domainOf(input.recipient);
  const peek = await standingApprovalAllows({
    organizationId: input.organizationId,
    actionType: "mail.send.batch",
  });
  if (peek.allowed && peek.policyId) {
    const policy = await findMatchingPolicy({
      organizationId: input.organizationId,
      actionType: "mail.send.batch",
    });
    const allowedDomains = policy ? parsePolicyConditions(policy.conditions).allowedRecipientDomains : [];
    const domainOk =
      !allowedDomains.length ||
      (domain && allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`)));
    if (domainOk) {
      return {
        approvalId: peek.policyId,
        viaStanding: true,
        reason: `${peek.reason} Sag „senden“, dann geht die Mail raus (Limit erst dann).`,
      };
    }
  }

  const approval = await createApprovalRequest({
    organizationId: input.organizationId,
    jobId: input.jobId,
    actionType: "mail.send",
    description: input.description,
    payload: input.payload,
  });
  return { approvalId: approval.id, viaStanding: false, reason: "Einzelfreigabe." };
}

export type PrepareMailDraftResult = {
  ok: boolean;
  reply: string;
  communicationId: string | null;
  approvalId?: string;
  needsAccount?: boolean;
  waitingApproval?: boolean;
};

export async function prepareMailDraft(input: {
  organizationId: string;
  userRequest: string;
  jobId?: string;
  projectId?: string;
}): Promise<PrepareMailDraftResult> {
  assertOrganizationId(input.organizationId);
  bootstrapAgents();

  const revises =
    /(?:^|[^\p{L}])(?:änder\w*|aender\w*|korrigier\w*|ergänz\w*|erganz\w*|überarbeit\w*|ueberarbeit\w*)\b/iu.test(
      ` ${input.userRequest}`,
    ) && /\bentwurf\b/i.test(input.userRequest);
  if (revises) {
    return reviseOpenDraft(input);
  }

  const accounts = filterSteerableMailAccounts(
    await prisma.mailAccount.findMany({
      where: { organizationId: input.organizationId, status: "connected" },
      orderBy: { updatedAt: "desc" },
    }),
  );
  if (!accounts.length) {
    return {
      ok: false,
      reply:
        "Für Entwurf und Versand steuert NOVA nur `info@elevum.io` und `joachim@rankpilot.de`. Keines dieser Konten ist verbunden.",
      communicationId: null,
    };
  }
  const preferred = await preferredMailAccount(input.organizationId);
  const suggested =
    (preferred &&
      isSteerableMailAddress(preferred.emailAddress) &&
      accounts.find((item) => item.id === preferred.id)) ||
    accounts[0] ||
    null;

  const pending = await loadPendingMailDraft(input.organizationId);
  const wantsOtherAccounts = /\b(?:andere konten|alle konten|welches konto|welche konten)\b/i.test(
    input.userRequest,
  );
  const freshDraft =
    detectMailIntent(input.userRequest).kind === "draft" && !looksLikeAccountPick(input.userRequest);
  const accountChoice = resolveAccountChoice(input.userRequest, accounts, {
    pending,
    suggested,
    allowAffirmative: Boolean(pending) && !freshDraft,
  });
  const continuing = Boolean(pending && accountChoice && !freshDraft);
  const mergedRequest = continuing
    ? mergePendingRequest(pending!.userRequest, accountChoice!.emailAddress)
    : input.userRequest;
  const spec = parseMailDraftSpec(mergedRequest);

  if (pending && !accountChoice && !freshDraft) {
    if (/^(abbrechen|cancel|vergiss|stopp)\.?$/i.test(input.userRequest.trim())) {
      await clearPendingMailDraft(input.organizationId);
      return {
        ok: true,
        reply: "Alles klar. Der wartende Mailauftrag ist verworfen. Es wurde nichts versendet.",
        communicationId: null,
        needsAccount: false,
        waitingApproval: false,
      };
    }

    // Folgenotiz zum gleichen Auftrag merken, dann erneut kurz nach Absender fragen.
    if (looksLikePendingMailFollowUp(input.userRequest) && !wantsOtherAccounts) {
      const addition = input.userRequest.trim();
      const nextRequest = `${pending.userRequest.trim()} ${addition}`.trim();
      const nextSpec = parseMailDraftSpec(nextRequest);
      await updatePendingMailDraft(input.organizationId, {
        userRequest: nextRequest,
        to: nextSpec.to ?? pending.to,
        subject: nextSpec.subject ?? pending.subject,
        bodyHint: nextSpec.bodyHint ?? pending.bodyHint,
        suggestedFrom: pending.suggestedFrom ?? suggested?.emailAddress ?? null,
      });
      return {
        ok: false,
        reply: formatAccountQuestion({
          accounts,
          suggested: suggestedAccount(accounts, pending.suggestedFrom ?? suggested?.emailAddress),
          rememberedBrief: summarizeBrief(nextRequest),
        }),
        communicationId: null,
        needsAccount: true,
        waitingApproval: false,
      };
    }

    return {
      ok: false,
      reply: formatAccountQuestion({
        accounts,
        suggested: wantsOtherAccounts
          ? null
          : suggestedAccount(accounts, pending.suggestedFrom ?? suggested?.emailAddress),
        rememberedBrief: summarizeBrief(pending.userRequest),
      }),
      communicationId: null,
      needsAccount: true,
      waitingApproval: false,
    };
  }

  if (!accounts.length) {
    await clearPendingMailDraft(input.organizationId);
    return {
      ok: false,
      reply:
        "Kein Mailkonto ist verbunden. Bitte einmal Apple Mail in NOVA verbinden. Es wurde nichts vorbereitet und nichts versendet.",
      communicationId: null,
      waitingApproval: false,
    };
  }

  const fromAccount =
    accountChoice ??
    (spec.from
      ? accounts.find((item) => item.emailAddress.toLowerCase() === spec.from) ?? null
      : null);

  if (!fromAccount) {
    if (spec.from) {
      return {
        ok: false,
        reply: `Das Absenderkonto ${spec.from} ist nicht verbunden. Es wurde nichts vorbereitet und nichts versendet.`,
        communicationId: null,
        waitingApproval: false,
      };
    }
    await savePendingMailDraft({
      organizationId: input.organizationId,
      userRequest: mergedRequest,
      spec,
      suggestedFrom: suggested?.emailAddress ?? null,
    });
    return {
      ok: false,
      reply: formatAccountQuestion({
        accounts,
        suggested,
        rememberedBrief: summarizeBrief(mergedRequest),
      }),
      communicationId: null,
      needsAccount: true,
      waitingApproval: false,
    };
  }

  await clearPendingMailDraft(input.organizationId);

  if (spec.to) {
    return createExplicitDraft({
      organizationId: input.organizationId,
      userRequest: mergedRequest,
      jobId: input.jobId,
      projectId: input.projectId,
      account: fromAccount,
      to: spec.to,
      subject: spec.subject,
      bodyHint: spec.bodyHint ?? pending?.bodyHint ?? null,
    });
  }

  return createReplyDraft({
    organizationId: input.organizationId,
    userRequest: mergedRequest,
    jobId: input.jobId,
    projectId: input.projectId,
    account: fromAccount,
    bodyHint: spec.bodyHint ?? pending?.bodyHint ?? null,
    subjectHint: spec.subject,
  });
}

function resolveAccountChoice(
  userRequest: string,
  accounts: Array<{ id: string; emailAddress: string; displayName: string | null }>,
  options?: {
    pending?: { suggestedFrom: string | null } | null;
    suggested?: { id: string; emailAddress: string; displayName: string | null } | null;
    allowAffirmative?: boolean;
  },
) {
  const email = extractAccountChoice(userRequest);
  if (email) {
    return accounts.find((item) => item.emailAddress.toLowerCase() === email) ?? null;
  }
  const numbered = userRequest.trim().match(/^(?:konto|absender|nummer)?\s*(\d{1,2})\.?$/i);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    return accounts[index] ?? null;
  }
  if (/^(die erste|erstes|dieses|dieses konto|das konto|von dort)\.?$/i.test(userRequest.trim())) {
    const suggestedEmail = options?.pending?.suggestedFrom ?? options?.suggested?.emailAddress;
    return suggestedAccount(accounts, suggestedEmail) ?? options?.suggested ?? accounts[0] ?? null;
  }
  if (options?.allowAffirmative && looksLikeAccountAffirmative(userRequest)) {
    const suggestedEmail = options.pending?.suggestedFrom ?? options.suggested?.emailAddress;
    return suggestedAccount(accounts, suggestedEmail) ?? options.suggested ?? accounts[0] ?? null;
  }
  const lowered = userRequest.trim().toLowerCase();
  if (lowered.length >= 3) {
    const byName = accounts.filter((item) => {
      const name = item.displayName?.toLowerCase() ?? "";
      const address = item.emailAddress.toLowerCase();
      return (
        name === lowered ||
        address === lowered ||
        address.startsWith(lowered) ||
        address.includes(lowered) ||
        name.includes(lowered)
      );
    });
    if (byName.length === 1) return byName[0];
  }
  return null;
}

function suggestedAccount(
  accounts: Array<{ id: string; emailAddress: string; displayName: string | null }>,
  email?: string | null,
) {
  if (!email) return null;
  return accounts.find((item) => item.emailAddress.toLowerCase() === email.toLowerCase()) ?? null;
}

function summarizeBrief(userRequest: string): string {
  return userRequest.replace(/\s+/g, " ").trim().slice(0, 180);
}

function mergePendingRequest(original: string, fromEmail: string): string {
  if (/\b(?:von|absender)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(original)) {
    return original.replace(
      /\b(?:von|absender)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      `von ${fromEmail}`,
    );
  }
  // Absender vorne, sonst landet er im Inhalts-Hint.
  return `von ${fromEmail}. ${original.trim()}`;
}

async function reviseOpenDraft(input: {
  organizationId: string;
  userRequest: string;
  jobId?: string;
}): Promise<PrepareMailDraftResult> {
  const open = await prisma.communication.findFirst({
    where: {
      organizationId: input.organizationId,
      channel: "email",
      direction: "outbound",
      sentAt: null,
      status: { notIn: ["sent", "executed", "awaiting_sender"] },
      deliveryStatus: { not: "AWAITING_SENDER" },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!open) {
    return {
      ok: false,
      reply: "Es liegt kein offener Entwurf vor. Nenne Empfänger und Text, dann lege ich einen an. Eine andere Mail nehme ich dafür nicht.",
      communicationId: null,
      waitingApproval: false,
    };
  }
  const next = nextDraftBody(open.body, input.userRequest);
  if (!next.changed) {
    return {
      ok: true,
      communicationId: open.id,
      reply: `Das ist weiterhin dieser Entwurf, Empfänger und Betreff bleiben.\nBetreff: ${open.subject}\n\n${stripDraftFooter(open.body).slice(0, 1200)}\n\nWas soll ich daran ändern?`,
      waitingApproval: false,
    };
  }
  const draft = await prisma.communication.update({
    where: { id: open.id },
    data: { body: next.body, deliveryStatus: "WAITING_FOR_APPROVAL" },
  });
  const account = draft.mailAccountId
    ? await prisma.mailAccount.findFirst({
        where: { id: draft.mailAccountId, organizationId: input.organizationId },
      })
    : null;
  const contact = draft.contactId
    ? await prisma.contact.findFirst({ where: { id: draft.contactId, organizationId: input.organizationId } })
    : null;
  const to =
    contact?.email ??
    draft.body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ??
    "unbekannt";
  const shown = formatDraftForApproval({
    from: account?.emailAddress ?? "unbekannt",
    to,
    subject: draft.subject,
    body: draft.body,
  });
  const approval = await requestMailSendApproval({
    organizationId: input.organizationId,
    jobId: input.jobId,
    description: shown,
    payload: { communicationIds: [draft.id], to: to === "unbekannt" ? undefined : to },
    recipient: to === "unbekannt" ? undefined : to,
  });
  return {
    ok: true,
    communicationId: draft.id,
    approvalId: approval.approvalId,
    reply: approval.viaStanding ? `${shown}\n\n${approval.reason}` : shown,
    waitingApproval: !approval.viaStanding,
  };
}

async function createExplicitDraft(input: {
  organizationId: string;
  userRequest: string;
  jobId?: string;
  projectId?: string;
  account: { id: string; emailAddress: string };
  to: string;
  subject: string | null;
  bodyHint: string | null;
}): Promise<PrepareMailDraftResult> {
  const agent = getAgent("communication");
  if (!agent) throw new Error("Communication Agent fehlt.");
  const subject = input.subject?.trim() || deriveSubject(input.bodyHint, input.userRequest);
  const literalBody = input.bodyHint?.trim() || undefined;
  const result = await agent.run(
    {
      mode: "reply",
      brief: input.userRequest,
      literalBody,
      mailAccountId: input.account.id,
      to: input.to,
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
    return { ok: false, reply: "Ich konnte keinen Entwurf anlegen.", communicationId: null, waitingApproval: false };
  }
  const draft = await prisma.communication.findFirst({
    where: { id: communicationId, organizationId: input.organizationId },
  });
  if (!draft) return { ok: false, reply: result.summary, communicationId: null, waitingApproval: false };
  await prisma.communication.update({
    where: { id: draft.id },
    data: {
      deliveryStatus: "WAITING_FOR_APPROVAL",
      mailAccountId: input.account.id,
      subject,
    },
  });
  const shown = formatDraftForApproval({
    from: input.account.emailAddress,
    to: input.to,
    subject,
    body: draft.body,
  });
  await auditMail({
    organizationId: input.organizationId,
    action: "DRAFT_CREATED",
    status: "prepared",
    detail: subject,
    jobId: input.jobId,
  });
  const approval = await requestMailSendApproval({
    organizationId: input.organizationId,
    jobId: input.jobId,
    description: shown,
    payload: { communicationIds: [draft.id], to: input.to },
    recipient: input.to,
  });
  await auditMail({
    organizationId: input.organizationId,
    action: "APPROVAL_REQUESTED",
    status: "prepared",
    detail: subject,
    jobId: input.jobId,
  });
  return {
    ok: true,
    communicationId: draft.id,
    approvalId: approval.approvalId,
    reply: approval.viaStanding ? `${shown}\n\n${approval.reason}` : shown,
    waitingApproval: !approval.viaStanding,
  };
}

async function createReplyDraft(input: {
  organizationId: string;
  userRequest: string;
  jobId?: string;
  projectId?: string;
  account: { id: string; emailAddress: string };
  bodyHint: string | null;
  subjectHint: string | null;
}): Promise<PrepareMailDraftResult> {
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
  if (!latest?.fromAddress) {
    return {
      ok: false,
      reply:
        "Für eine neue Mail brauche ich den Empfänger (z. B. „an name@domain.de“) und den Inhalt. Es wurde nichts versendet.",
      communicationId: null,
      waitingApproval: false,
    };
  }
  const thread = latest
    ? await prisma.mailThread.findFirst({
        where: { id: latest.threadId, organizationId: input.organizationId },
        include: { messages: { orderBy: { receivedAt: "asc" }, take: 8 } },
      })
    : null;
  const agent = getAgent("communication");
  if (!agent) throw new Error("Communication Agent fehlt.");
  const subject =
    input.subjectHint?.trim() ||
    (latest.subject ? `Re: ${latest.subject.replace(/^re:\s*/i, "")}` : "Antwort");
  const result = await agent.run(
    {
      mode: "reply",
      brief: input.userRequest,
      literalBody: input.bodyHint ?? undefined,
      mailThreadId: thread?.id,
      mailAccountId: input.account.id,
      to: latest.fromAddress,
      subject,
      inReplyTo: latest.internetMessageId ?? undefined,
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
    return { ok: false, reply: "Ich konnte keinen Entwurf anlegen.", communicationId: null, waitingApproval: false };
  }
  const draft = await prisma.communication.findFirst({
    where: { id: communicationId, organizationId: input.organizationId },
  });
  if (!draft) return { ok: false, reply: result.summary, communicationId: null, waitingApproval: false };
  await prisma.communication.update({
    where: { id: draft.id },
    data: { deliveryStatus: "WAITING_FOR_APPROVAL", mailAccountId: input.account.id, subject },
  });
  await auditMail({
    organizationId: input.organizationId,
    action: "DRAFT_CREATED",
    threadId: draft.mailThreadId ?? undefined,
    status: "prepared",
    detail: draft.subject,
    jobId: input.jobId,
  });
  const shown = formatDraftForApproval({
    from: input.account.emailAddress,
    to: latest.fromAddress,
    subject,
    body: draft.body,
  });
  const approval = await requestMailSendApproval({
    organizationId: input.organizationId,
    jobId: input.jobId,
    description: shown,
    payload: { communicationIds: [draft.id], to: latest.fromAddress },
    recipient: latest.fromAddress,
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
    approvalId: approval.approvalId,
    reply: approval.viaStanding ? `${shown}\n\n${approval.reason}` : shown,
    waitingApproval: !approval.viaStanding,
  };
}

function deriveSubject(bodyHint: string | null, userRequest: string): string {
  if (bodyHint) {
    const line = stripDraftFooter(bodyHint).split(/\n/).map((item) => item.trim()).find(Boolean);
    if (line && line.length >= 4 && !/^guten tag/i.test(line) && !/^hallo/i.test(line)) {
      return line.slice(0, 80);
    }
  }
  const cleaned = userRequest
    .replace(/\b(?:schreib(?:e|en)?|verfass(?:e|en)?|schick(?:e|en)?|send(?:e|en)?|eine?|mail|e-?mail|an|von)\b/gi, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length >= 4) return cleaned.slice(0, 80);
  return "Nachricht";
}
