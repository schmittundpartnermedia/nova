import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { addJobStep, completeJobStep, createJob, getJob, updateJobStatus } from "@/services/jobs";
import { createSource, upsertDurableMemory } from "@/services/memory";
import { relateMemory } from "@/services/memory/relations";
import { resolveExistingEntity } from "@/lib/knowledge/entities";
import { ingestKnowledgeBuffer } from "@/services/knowledge";
import { createKnowledgeImport } from "@/services/knowledge/jobs";
import { upsertChunks } from "@/services/retrieval/embeddings";
import { htmlToNormalizedText } from "@/lib/mail/html";
import { extractNewMessage } from "@/lib/mail/quotes";
import { classifyMail, detectPriority, isConsumerDomain } from "@/lib/mail/classify";
import { inspectMailContent } from "@/lib/mail/guard";
import { auditMail } from "@/services/mail/audit";
import { mergeAppleCursor } from "@/lib/mail/apple";
import { completeFollowUpsForInbound, createMailFollowUp } from "@/services/mail/followup";
import type { MailProvider, MailProviderMessage } from "@/types/connectors";
import type { MemoryType } from "@/types";

const ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const ALLOWED_ATTACHMENT = /\.(pdf|docx|xlsx|csv|json|txt|md)$/i;
const ROLE_LOCAL = /^(info|noreply|no-reply|newsletter|mailer-daemon|support)$/i;

type Phase = "CONNECTING" | "FETCHING" | "NORMALIZING" | "LINKING" | "INDEXING" | "VERIFYING" | "COMPLETED";

function addresses(list: MailProviderMessage["to"]) {
  return JSON.stringify(list.map((item) => ({ name: item.name ?? "", email: item.email.toLowerCase() })));
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function factsFrom(text: string): Array<{ type: MemoryType; title: string; content: string }> {
  const found: Array<{ type: MemoryType; title: string; content: string }> = [];
  const line = text.replace(/\s+/g, " ").trim();
  if (/angebot|preis|\d+\s*€|euro/i.test(line)) found.push({ type: "fact", title: line.slice(0, 72), content: line.slice(0, 400) });
  if (/deadline|frist|bis (zum|morgen|freitag|montag)/i.test(line)) found.push({ type: "task", title: "Frist aus Mail", content: line.slice(0, 400) });
  if (/zusage|vereinbar|telefonieren|angebot/i.test(line)) found.push({ type: "decision", title: "Vereinbarung aus Mail", content: line.slice(0, 400) });
  return found.slice(0, 3);
}

async function runPhase(input: {
  organizationId: string;
  jobId: string;
  phase: Phase;
  work: () => Promise<void>;
}) {
  const job = await getJob(input.organizationId, input.jobId);
  if (job?.status === "cancelled") {
    const error = new Error("CANCELLED");
    throw error;
  }
  const step = await addJobStep({
    organizationId: input.organizationId,
    jobId: input.jobId,
    agent: "mail",
    action: input.phase,
    input: { phase: input.phase },
  });
  await input.work();
  await completeJobStep({ organizationId: input.organizationId, stepId: step.id, status: "completed", output: { phase: input.phase } });
}

export async function startMailSync(input: { organizationId: string; accountId: string; provider: MailProvider }) {
  assertOrganizationId(input.organizationId);
  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: "mail sync",
    goal: "Postfach synchronisieren",
  });
  await updateJobStatus(input.organizationId, job.id, "running", { startedAt: new Date() });
  try {
    const result = await syncMailAccount({ ...input, jobId: job.id });
    await updateJobStatus(input.organizationId, job.id, "completed", { completedAt: new Date() });
    return { jobId: job.id, ...result };
  } catch (error) {
    const cancelled = error instanceof Error && error.message === "CANCELLED";
    await updateJobStatus(input.organizationId, job.id, cancelled ? "cancelled" : "failed", { completedAt: new Date() });
    if (!cancelled) throw error;
    return { jobId: job.id, imported: 0, cancelled: true };
  }
}

export async function syncMailAccount(input: {
  organizationId: string;
  accountId: string;
  provider: MailProvider;
  jobId: string;
}) {
  assertOrganizationId(input.organizationId);
  const account = await prisma.mailAccount.findFirst({
    where: { id: input.accountId, organizationId: input.organizationId },
  });
  if (!account) throw new Error("Mailkonto nicht gefunden.");
  let imported = 0;

  await runPhase({
    organizationId: input.organizationId,
    jobId: input.jobId,
    phase: "CONNECTING",
    work: async () => {
      const health = await input.provider.healthCheck(input.organizationId, account.id);
      if (!health.live) {
        const reason = health.reason === "AUTOMATION_PERMISSION_REQUIRED" ? "AUTOMATION_PERMISSION_REQUIRED" : "PROVIDER_UNAVAILABLE";
        await prisma.mailAccount.update({
          where: { id: account.id },
          data: { lastError: reason },
        });
        throw new Error(reason);
      }
      await prisma.mailAccount.update({ where: { id: account.id }, data: { lastError: null } });
    },
  });

  const cursor = account.syncCursor ? (JSON.parse(account.syncCursor) as { lastUid?: number; uidValidity?: string; mode?: string }) : {};
  const apple = input.provider.id === "apple-mail";
  let remote: MailProviderMessage[] = [];
  await runPhase({
    organizationId: input.organizationId,
    jobId: input.jobId,
    phase: "FETCHING",
    work: async () => {
      remote = await input.provider.listMessages({
        organizationId: input.organizationId,
        accountId: account.id,
        folder: "INBOX",
        sinceUid: cursor.lastUid,
        uidValidity: apple ? (account.syncCursor ?? undefined) : cursor.uidValidity,
        limit: apple ? 4 : 50,
      });
    },
  });

  const normalized: Array<MailProviderMessage & { normalizedText: string; injectionSuspected: boolean }> = [];
  await runPhase({
    organizationId: input.organizationId,
    jobId: input.jobId,
    phase: "NORMALIZING",
    work: async () => {
      for (const message of remote) {
        const raw = message.textBody?.trim() ? message.textBody : htmlToNormalizedText(message.htmlBody ?? "");
        const extracted = extractNewMessage(raw);
        const inspected = inspectMailContent(extracted.fresh || raw);
        normalized.push({ ...message, normalizedText: inspected.safeText, injectionSuspected: inspected.injectionSuspected });
      }
    },
  });

  let maxUid = cursor.lastUid ?? 0;
  await runPhase({
    organizationId: input.organizationId,
    jobId: input.jobId,
    phase: "LINKING",
    work: async () => {
      for (const message of normalized) {
        const saved = await upsertNormalizedMessage({
          organizationId: input.organizationId,
          accountId: account.id,
          ownAddress: account.emailAddress,
          message,
          provider: input.provider,
        });
        if (saved) imported += 1;
        if (message.uid && message.uid > maxUid) maxUid = message.uid;
      }
    },
  });

  await runPhase({
    organizationId: input.organizationId,
    jobId: input.jobId,
    phase: "INDEXING",
    work: async () => {
      const rows = await prisma.mailMessage.findMany({
        where: { organizationId: input.organizationId, accountId: account.id },
        orderBy: { receivedAt: "desc" },
        take: 50,
        include: { thread: true },
      });
      if (!rows.length) return;
      await upsertChunks(
        rows.map((row) => ({
          organizationId: input.organizationId,
          objectType: "mail_message",
          objectId: row.id,
          layer: "mail" as const,
          title: row.subject,
          text: `${row.fromName ?? ""} ${row.fromAddress}\n${row.subject}\n${row.normalizedText}`.slice(0, 8000),
          sourceType: "email",
          projectId: row.thread.projectId,
          occurredAt: row.receivedAt,
          epistemicStatus: "USER_STATED",
          locationJson: JSON.stringify({ threadId: row.threadId, messageId: row.id }),
        })),
      ).catch(() => undefined);
    },
  });

  await runPhase({
    organizationId: input.organizationId,
    jobId: input.jobId,
    phase: "VERIFYING",
    work: async () => {
      const count = await prisma.mailMessage.count({
        where: { organizationId: input.organizationId, accountId: account.id },
      });
      if (count < imported) throw new Error("Sync-Prüfung fehlgeschlagen.");
    },
  });

  await runPhase({
    organizationId: input.organizationId,
    jobId: input.jobId,
    phase: "COMPLETED",
    work: async () => {
      await prisma.mailAccount.update({
        where: { id: account.id },
        data: {
          lastSyncAt: new Date(),
          syncCursor: apple
            ? mergeAppleCursor(
                account.syncCursor,
                normalized.map((item) => item.providerMessageId),
              )
            : JSON.stringify({ lastUid: maxUid, uidValidity: normalized.at(-1)?.uidValidity ?? cursor.uidValidity }),
        },
      });
      await auditMail({
        organizationId: input.organizationId,
        action: "SYNC",
        accountId: account.id,
        status: "completed",
        detail: `${imported} Nachrichten indexiert`,
        jobId: input.jobId,
      });
    },
  });

  return { imported, cancelled: false };
}

export async function importMailMessages(input: {
  organizationId: string;
  accountId: string;
  provider: MailProvider;
  messages: MailProviderMessage[];
}) {
  assertOrganizationId(input.organizationId);
  const account = await prisma.mailAccount.findFirst({
    where: { id: input.accountId, organizationId: input.organizationId },
  });
  if (!account || !input.messages.length) return 0;
  let imported = 0;
  for (const message of input.messages) {
    const raw = message.textBody?.trim() ? message.textBody : htmlToNormalizedText(message.htmlBody ?? "");
    const extracted = extractNewMessage(raw);
    const inspected = inspectMailContent(extracted.fresh || raw);
    const saved = await upsertNormalizedMessage({
      organizationId: input.organizationId,
      accountId: account.id,
      ownAddress: account.emailAddress,
      provider: input.provider,
      message: { ...message, normalizedText: inspected.safeText, injectionSuspected: inspected.injectionSuspected },
    });
    if (saved) imported += 1;
  }
  if (input.provider.id === "apple-mail") {
    await prisma.mailAccount.update({
      where: { id: account.id },
      data: {
        syncCursor: mergeAppleCursor(
          account.syncCursor,
          input.messages.map((item) => item.providerMessageId),
        ),
        lastSyncAt: new Date(),
      },
    });
  }
  return imported;
}

async function upsertNormalizedMessage(input: {
  organizationId: string;
  accountId: string;
  ownAddress: string;
  provider: MailProvider;
  message: MailProviderMessage & { normalizedText: string; injectionSuspected: boolean };
}) {
  const existing = await prisma.mailMessage.findFirst({
    where: {
      organizationId: input.organizationId,
      accountId: input.accountId,
      providerMessageId: input.message.providerMessageId,
    },
  });
  if (existing) return null;

  const thread = await prisma.mailThread.upsert({
    where: {
      organizationId_accountId_providerThreadId: {
        organizationId: input.organizationId,
        accountId: input.accountId,
        providerThreadId: input.message.providerThreadId,
      },
    },
    create: {
      organizationId: input.organizationId,
      accountId: input.accountId,
      providerThreadId: input.message.providerThreadId,
      subject: input.message.subject,
      participants: addresses([input.message.from, ...input.message.to]),
      lastMessageAt: input.message.receivedAt ? new Date(input.message.receivedAt) : new Date(),
    },
    update: {
      lastMessageAt: input.message.receivedAt ? new Date(input.message.receivedAt) : new Date(),
      subject: input.message.subject || undefined,
    },
  });

  const knownContact = await prisma.contact.findFirst({
    where: { organizationId: input.organizationId, email: input.message.from.email.toLowerCase() },
  });
  const company = await matchCompany(input.organizationId, input.message.subject, input.message.normalizedText, input.message.from.email);
  const project = await matchProject({
    organizationId: input.organizationId,
    subject: input.message.subject,
    text: input.message.normalizedText,
    contactProjectId: knownContact?.projectId,
    companyProjectId: company?.projectId,
  });
  const classification = classifyMail({
    from: input.message.from.email,
    subject: input.message.subject,
    text: input.message.normalizedText,
    headers: input.message.headers,
    knownImportant: Boolean(knownContact || company || project.projectId),
  });
  const priority = detectPriority({
    classification,
    knownContact: Boolean(knownContact),
    knownCompany: Boolean(company),
    knownProject: Boolean(project.projectId),
    text: input.message.normalizedText,
  });

  if (project.projectId && (project.confidence ?? 0) >= 0.75) {
    await prisma.mailThread.update({
      where: { id: thread.id },
      data: {
        projectId: project.projectId,
        companyId: company?.id,
        contactId: knownContact?.id,
        linkConfidence: project.confidence,
      },
    });
  } else if (knownContact || company) {
    await prisma.mailThread.update({
      where: { id: thread.id },
      data: { companyId: company?.id, contactId: knownContact?.id, linkConfidence: project.confidence ?? 0.4 },
    });
  }

  const row = await prisma.mailMessage.create({
    data: {
      organizationId: input.organizationId,
      accountId: input.accountId,
      threadId: thread.id,
      providerMessageId: input.message.providerMessageId,
      providerThreadId: input.message.providerThreadId,
      internetMessageId: input.message.internetMessageId,
      folder: input.message.folder,
      fromAddress: input.message.from.email.toLowerCase(),
      fromName: input.message.from.name,
      toJson: addresses(input.message.to),
      ccJson: addresses(input.message.cc),
      bccJson: addresses(input.message.bcc),
      subject: input.message.subject,
      textBody: input.message.textBody,
      htmlBody: input.message.htmlBody,
      normalizedText: input.message.normalizedText,
      sentAt: input.message.sentAt ? new Date(input.message.sentAt) : undefined,
      receivedAt: input.message.receivedAt ? new Date(input.message.receivedAt) : undefined,
      isRead: input.message.isRead,
      direction: input.message.from.email.toLowerCase() === input.ownAddress.toLowerCase() ? "outbound" : input.message.direction,
      headersJson: JSON.stringify(input.message.headers),
      classification,
      priority: priority.priority,
      priorityReason: priority.reason,
      injectionSuspected: input.message.injectionSuspected,
      uid: input.message.uid,
      uidValidity: input.message.uidValidity,
    },
  });

  if (row.direction === "inbound") {
    await completeFollowUpsForInbound({
      organizationId: input.organizationId,
      threadId: thread.id,
      from: row.fromAddress,
    });
  }
  if (row.direction === "outbound" && /\?/.test(input.message.normalizedText)) {
    const expected = input.message.to[0]?.email;
    await createMailFollowUp({
      organizationId: input.organizationId,
      threadId: thread.id,
      expectedFrom: expected,
      dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      reason: "Antwort auf unsere Mail erwartet",
    });
  }
  await linkPerson(input.organizationId, input.message, knownContact?.id);
  if (classification !== "NEWSLETTER" && classification !== "SPAM_OR_LOW_VALUE") {
    await rememberMail({
      organizationId: input.organizationId,
      messageId: row.id,
      threadId: thread.id,
      subject: input.message.subject,
      text: input.message.normalizedText,
      projectId: project.confidence && project.confidence >= 0.75 ? project.projectId : undefined,
      companyId: company?.id,
      contactId: knownContact?.id,
    });
  }
  await storeAttachments({
    organizationId: input.organizationId,
    messageId: row.id,
    providerMessageId: input.message.providerMessageId,
    accountId: input.accountId,
    attachments: input.message.attachments,
    projectId: project.confidence && project.confidence >= 0.75 ? project.projectId : undefined,
    provider: input.provider,
  });
  return row;
}

async function matchCompany(organizationId: string, subject: string, text: string, fromEmail: string) {
  const domain = domainOf(fromEmail);
  if (!domain || isConsumerDomain(domain)) return null;
  const companies = await prisma.company.findMany({
    where: { organizationId },
    select: { id: true, name: true, website: true, projectId: true },
    take: 200,
  });
  const blob = `${subject}\n${text}`.toLowerCase();
  return (
    companies.find((company) => (company.website ?? "").toLowerCase().includes(domain)) ??
    companies.find((company) => company.name.length > 2 && blob.includes(company.name.toLowerCase())) ??
    null
  );
}

async function matchProject(input: {
  organizationId: string;
  subject: string;
  text: string;
  contactProjectId?: string | null;
  companyProjectId?: string | null;
}) {
  if (input.contactProjectId) return { projectId: input.contactProjectId, confidence: 0.9 };
  if (input.companyProjectId) return { projectId: input.companyProjectId, confidence: 0.8 };
  const projects = await prisma.project.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, name: true },
    take: 100,
  });
  const blob = `${input.subject}\n${input.text}`.toLowerCase();
  const hit = projects.find((project) => project.name.length > 3 && blob.includes(project.name.toLowerCase()));
  if (!hit) return { projectId: undefined as string | undefined, confidence: 0.2 };
  const entity = await resolveExistingEntity({ organizationId: input.organizationId, name: hit.name, kind: "project" });
  return { projectId: entity?.id ?? hit.id, confidence: entity ? 0.86 : 0.7 };
}

async function linkPerson(organizationId: string, message: MailProviderMessage, existingId?: string) {
  if (existingId) return existingId;
  const email = message.from.email.toLowerCase();
  const local = email.split("@")[0] ?? "";
  if (ROLE_LOCAL.test(local)) return null;
  const name = (message.from.name ?? "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const sameName = await prisma.contact.findMany({
    where: { organizationId, firstName: parts[0], lastName: parts.slice(1).join(" ") },
    take: 3,
  });
  if (sameName.length) return null;
  return null;
}

async function rememberMail(input: {
  organizationId: string;
  messageId: string;
  threadId: string;
  subject: string;
  text: string;
  projectId?: string;
  companyId?: string;
  contactId?: string;
}) {
  const source = await createSource({
    organizationId: input.organizationId,
    type: "email",
    reference: input.messageId,
    title: input.subject,
    label: input.subject,
    metadata: { threadId: input.threadId, messageId: input.messageId },
  });
  for (const fact of factsFrom(input.text)) {
    const memory = await upsertDurableMemory({
      organizationId: input.organizationId,
      type: fact.type,
      title: fact.title,
      content: fact.content,
      projectId: input.projectId,
      companyId: input.companyId,
      contactId: input.contactId,
      sourceId: source.id,
      sourceType: "email",
      sourceReference: input.messageId,
    });
    if (!memory) continue;
  }
}

async function storeAttachments(input: {
  organizationId: string;
  messageId: string;
  providerMessageId: string;
  accountId: string;
  attachments: MailProviderMessage["attachments"];
  projectId?: string;
  provider: MailProvider;
}) {
  for (const attachment of input.attachments) {
    const allowed = ALLOWED_ATTACHMENT.test(attachment.filename);
    const tooBig = attachment.size > ATTACHMENT_LIMIT;
    const row = await prisma.mailAttachment.create({
      data: {
        organizationId: input.organizationId,
        messageId: input.messageId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        contentId: attachment.contentId,
        status: !allowed || tooBig ? "skipped" : "pending",
        skipReason: tooBig ? "too-large" : !allowed ? "type" : undefined,
      },
    });
    if (!allowed || tooBig) continue;
    const downloaded = await input.provider.downloadAttachment({
      organizationId: input.organizationId,
      accountId: input.accountId,
      providerMessageId: input.providerMessageId,
      attachmentId: attachment.id,
    });
    if (!downloaded.ok || !downloaded.bytes) {
      await prisma.mailAttachment.update({ where: { id: row.id }, data: { status: "skipped", skipReason: "download" } });
      continue;
    }
    const knowledgeImport = await createKnowledgeImport({
      organizationId: input.organizationId,
      userRequest: `mail attachment ${attachment.filename}`,
      kind: "mail-attachment",
    });
    const ingested = await ingestKnowledgeBuffer({
      organizationId: input.organizationId,
      importId: knowledgeImport.id,
      name: attachment.filename,
      bytes: downloaded.bytes,
      mimeType: attachment.mimeType,
      projectId: input.projectId,
    });
    await prisma.mailAttachment.update({
      where: { id: row.id },
      data: { status: ingested.sourceId ? "indexed" : "skipped", knowledgeSourceId: ingested.sourceId || null, skipReason: ingested.skipped },
    });
    if (ingested.sourceId) {
      const source = await createSource({
        organizationId: input.organizationId,
        type: "document",
        reference: row.id,
        title: attachment.filename,
        metadata: { relation: "attached_to", mailMessageId: input.messageId },
      });
      await prisma.source.updateMany({
        where: { id: source.id, organizationId: input.organizationId },
        data: { knowledgeSourceId: ingested.sourceId },
      });
      const memory = await upsertDurableMemory({
        organizationId: input.organizationId,
        type: "fact",
        title: `Anhang ${attachment.filename}`,
        content: `Anhang ${attachment.filename} gehört zur Mail ${input.messageId}.`,
        sourceId: source.id,
        sourceType: "email",
        sourceReference: input.messageId,
        projectId: input.projectId,
      });
      if (memory) {
        const mailMemory = await upsertDurableMemory({
          organizationId: input.organizationId,
          type: "communication",
          title: `Mail ${input.messageId}`,
          content: `Nachricht ${input.messageId}`,
          sourceId: source.id,
          sourceType: "email",
          sourceReference: input.messageId,
        });
        if (mailMemory && mailMemory.id !== memory.id) {
          await relateMemory({
            organizationId: input.organizationId,
            fromId: memory.id,
            toId: mailMemory.id,
            relationType: "attached_to",
            metadata: { attachmentId: row.id },
          }).catch(() => undefined);
        }
      }
    }
  }
}

