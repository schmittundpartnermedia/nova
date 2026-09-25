import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { BaseMailProvider } from "@/connectors/mail/base";
import { readMailAutomationState, runMailAppleScript } from "@/services/mail/apple-events";
import {
  appleRefFromCapabilities,
  archiveScript,
  deliveryFromVerification,
  discardOutgoingScript,
  folderRole,
  forwardDraftScript,
  forwardSendScript,
  inboxMetadataScript,
  localStampToIso,
  mailboxListScript,
  markReadScript,
  messageDetailScript,
  newSendScript,
  outgoingCheckScript,
  outgoingDraftScript,
  parseAppleCursor,
  parseAttachments,
  parseDetail,
  parseMailAddress,
  parseRecords,
  replyDraftScript,
  replySendScript,
  saveAttachmentScript,
  searchInboxScript,
  sentLookupScript,
  threadKey,
} from "@/lib/mail/apple";
import type {
  MailListQuery,
  MailProviderAttachment,
  MailProviderDraft,
  MailProviderFolder,
  MailProviderMessage,
  MailSendInput,
  MailSendResult,
} from "@/types/connectors";

const failed = (reason: string): MailSendResult => ({
  ok: false,
  executed: false,
  mock: false,
  status: "FAILED",
  reason,
});

function addresses(raw: string) {
  return raw
    .split(",")
    .map((item) => parseMailAddress(item))
    .filter((item) => item.email.includes("@"));
}

function toMessage(input: {
  ownAddress: string;
  appleId: string;
  mailbox: string;
  sender: string;
  subject: string;
  stamp: string;
  read: string;
  headerId: string;
  to: string;
  cc: string;
  bcc: string;
  inReplyTo: string;
  references: string;
  body: string;
  attachments: ReturnType<typeof parseAttachments>;
}): MailProviderMessage {
  const from = parseMailAddress(input.sender);
  const thread = threadKey({
    messageId: input.headerId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    appleId: input.appleId,
  });
  const receivedAt = localStampToIso(input.stamp);
  const fromEmail = from.email || "unknown@apple-mail.local";
  return {
    providerMessageId: input.appleId,
    providerThreadId: thread.key,
    internetMessageId: input.headerId || undefined,
    folder: input.mailbox || "INBOX",
    from: { name: from.name, email: fromEmail },
    to: addresses(input.to),
    cc: addresses(input.cc),
    bcc: addresses(input.bcc),
    subject: input.subject,
    textBody: input.body,
    receivedAt,
    sentAt: receivedAt,
    isRead: input.read === "true",
    direction: fromEmail.toLowerCase() === input.ownAddress.toLowerCase() ? "outbound" : "inbound",
    headers: {
      "message-id": input.headerId,
      "in-reply-to": input.inReplyTo,
      references: input.references,
      "x-nova-thread-basis": thread.basis,
      "x-nova-apple-id": input.appleId,
      "x-nova-account": input.ownAddress,
    },
    attachments: input.attachments.map((item) => ({
      id: item.id,
      filename: item.name,
      mimeType: item.mime,
      size: item.size,
      contentId: item.id,
    })),
  };
}

async function accountContext(organizationId: string, accountId: string) {
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, organizationId, provider: "apple-mail" },
  });
  if (!account) return null;
  const appleId = appleRefFromCapabilities(account.capabilities);
  if (!appleId) return null;
  return { account, appleId };
}

export class AppleMailProvider extends BaseMailProvider {
  id = "apple-mail";
  mock = false;

  async authStatus(organizationId: string) {
    const account = await prisma.mailAccount.findFirst({
      where: { organizationId, provider: "apple-mail", status: "connected" },
    });
    return { connected: Boolean(account), reason: account ? "apple-mail" : "ACCOUNT_NOT_CONNECTED" };
  }

  async healthCheck(organizationId: string) {
    const state = await readMailAutomationState();
    if (state !== "granted") {
      return {
        ok: false,
        live: false,
        reason: state === "unavailable" ? "PROVIDER_UNAVAILABLE" : "AUTOMATION_PERMISSION_REQUIRED",
      };
    }
    const account = await prisma.mailAccount.findFirst({
      where: { organizationId, provider: "apple-mail", status: "connected" },
    });
    if (!account) return { ok: false, live: false, reason: "ACCOUNT_NOT_CONNECTED" };
    return { ok: true, live: true, reason: "apple-mail" };
  }

  async listFolders(organizationId: string, accountId: string): Promise<MailProviderFolder[]> {
    const context = await accountContext(organizationId, accountId);
    if (!context) return [];
    const result = await runMailAppleScript(mailboxListScript(context.appleId), 20_000);
    if (!result.ok) return [];
    return parseRecords(result.output).map((row, index) => ({
      id: `${index}:${row[0] || "mailbox"}`,
      name: row[0] || "Mailbox",
      role: folderRole(row[0] || ""),
    }));
  }

  async listMessages(query: MailListQuery): Promise<MailProviderMessage[]> {
    const context = await accountContext(query.organizationId, query.accountId);
    if (!context) return [];
    const limit = Math.min(Math.max(query.limit ?? 4, 1), 6);
    const known = parseAppleCursor(query.uidValidity).knownIds;
    const listed = await runMailAppleScript(inboxMetadataScript(context.appleId, limit), 25_000);
    if (!listed.ok) {
      if (listed.permission) throw new Error("AUTOMATION_PERMISSION_REQUIRED");
      throw new Error(listed.error);
    }
    const rows = parseRecords(listed.output);
    const unique = new Map<string, string[]>();
    for (const row of rows) {
      if (row[0] && !unique.has(row[0])) unique.set(row[0], row);
    }
    const fresh = [...unique.values()].filter((row) => !known.includes(row[0] ?? "")).slice(0, limit);
    const messages: MailProviderMessage[] = [];
    for (const row of fresh) {
      const mailbox = row[1] || "INBOX";
      const detail = await runMailAppleScript(messageDetailScript(context.appleId, mailbox, row[0] ?? ""), 20_000);
      if (!detail.ok) continue;
      const parsed = parseDetail(detail.output);
      messages.push(
        toMessage({
          ownAddress: context.account.emailAddress,
          appleId: parsed.fields[0] || row[0] || "",
          mailbox,
          sender: parsed.fields[2] || row[2] || "",
          subject: parsed.fields[3] || row[3] || "",
          stamp: parsed.fields[4] || row[4] || "",
          read: parsed.fields[5] || row[5] || "false",
          headerId: parsed.fields[1] || row[6] || "",
          to: parsed.fields[6] || "",
          cc: parsed.fields[7] || "",
          bcc: parsed.fields[8] || "",
          inReplyTo: parsed.fields[9] || "",
          references: parsed.fields[10] || "",
          body: parsed.body,
          attachments: parseAttachments(parsed.fields[11] || ""),
        }),
      );
    }
    return messages;
  }

  async getMessage(organizationId: string, accountId: string, providerMessageId: string) {
    const context = await accountContext(organizationId, accountId);
    if (!context) return null;
    const stored = await prisma.mailMessage.findFirst({
      where: { organizationId, accountId, providerMessageId },
    });
    const mailbox = stored?.folder || "INBOX";
    const detail = await runMailAppleScript(messageDetailScript(context.appleId, mailbox, providerMessageId), 20_000);
    if (!detail.ok) return null;
    const parsed = parseDetail(detail.output);
    return toMessage({
      ownAddress: context.account.emailAddress,
      appleId: parsed.fields[0] || providerMessageId,
      mailbox,
      sender: parsed.fields[2] || "",
      subject: parsed.fields[3] || "",
      stamp: parsed.fields[4] || "",
      read: parsed.fields[5] || "false",
      headerId: parsed.fields[1] || "",
      to: parsed.fields[6] || "",
      cc: parsed.fields[7] || "",
      bcc: parsed.fields[8] || "",
      inReplyTo: parsed.fields[9] || "",
      references: parsed.fields[10] || "",
      body: parsed.body,
      attachments: parseAttachments(parsed.fields[11] || ""),
    });
  }

  async search(organizationId: string, query: string): Promise<MailProviderMessage[]> {
    const term = query.trim().slice(0, 80);
    if (term.length < 2) return [];
    const accounts = await prisma.mailAccount.findMany({
      where: { organizationId, provider: "apple-mail", status: "connected" },
      take: 3,
    });
    const messages: MailProviderMessage[] = [];
    for (const account of accounts) {
      const appleId = appleRefFromCapabilities(account.capabilities);
      if (!appleId) continue;
      const listed = await runMailAppleScript(searchInboxScript(appleId, term), 18_000);
      if (!listed.ok) continue;
      for (const row of parseRecords(listed.output).slice(0, 3)) {
        const detail = await runMailAppleScript(messageDetailScript(appleId, row[1] || "INBOX", row[0] || ""), 18_000);
        if (!detail.ok) continue;
        const parsed = parseDetail(detail.output);
        messages.push(
          toMessage({
            ownAddress: account.emailAddress,
            appleId: parsed.fields[0] || row[0] || "",
            mailbox: row[1] || "INBOX",
            sender: parsed.fields[2] || row[2] || "",
            subject: parsed.fields[3] || row[3] || "",
            stamp: parsed.fields[4] || row[4] || "",
            read: parsed.fields[5] || row[5] || "false",
            headerId: parsed.fields[1] || row[6] || "",
            to: parsed.fields[6] || "",
            cc: parsed.fields[7] || "",
            bcc: parsed.fields[8] || "",
            inReplyTo: parsed.fields[9] || "",
            references: parsed.fields[10] || "",
            body: parsed.body,
            attachments: parseAttachments(parsed.fields[11] || ""),
          }),
        );
      }
      if (messages.length) break;
    }
    return messages;
  }

  async createDraft(input: MailSendInput): Promise<MailProviderDraft> {
    const context = input.accountId ? await accountContext(input.organizationId, input.accountId) : null;
    const appleId = context?.appleId;
    const mailbox = input.accountId
      ? (await prisma.mailMessage.findFirst({
          where: { organizationId: input.organizationId, accountId: input.accountId, providerMessageId: input.providerMessageId },
        }))?.folder
      : undefined;
    let script: string | null = null;
    if (input.compose === "reply" && appleId && input.providerMessageId) {
      script = replyDraftScript({
        accountId: appleId,
        mailbox: mailbox || "INBOX",
        messageId: input.providerMessageId,
        body: input.body,
        replyAll: input.replyAll === true,
      });
    } else if (input.compose === "forward" && appleId && input.providerMessageId) {
      script = forwardDraftScript({
        accountId: appleId,
        mailbox: mailbox || "INBOX",
        messageId: input.providerMessageId,
        to: input.to,
        body: input.body,
      });
    } else if (context) {
      script = outgoingDraftScript({
        accountEmail: context.account.emailAddress,
        to: input.to,
        subject: input.subject,
        body: input.body,
      });
    }
    if (!script) {
      return { providerMessageId: `local-draft-${Date.now()}`, subject: input.subject, body: input.body };
    }
    const created = await runMailAppleScript(script, 25_000);
    if (!created.ok) {
      return { providerMessageId: `local-draft-${Date.now()}`, subject: input.subject, body: input.body };
    }
    return {
      providerMessageId: created.output.trim() || `local-draft-${Date.now()}`,
      subject: input.subject,
      body: input.body,
    };
  }

  async send(input: MailSendInput): Promise<MailSendResult> {
    const context = input.accountId ? await accountContext(input.organizationId, input.accountId) : null;
    if (!context || context.account.emailAddress.endsWith("@apple-mail.local")) {
      return failed("Kein Apple-Mail-Konto für den Versand.");
    }
    const sent = await runMailAppleScript(
      newSendScript({ sender: context.account.emailAddress, to: input.to, subject: input.subject, body: input.body }),
      40_000,
    );
    if (!sent.ok) return failed(sent.error);
    return this.confirmSent(context.appleId, input.subject, input.to, sent.output);
  }

  async reply(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    const context = input.accountId ? await accountContext(input.organizationId, input.accountId) : null;
    if (!context) return failed("Kein Apple-Mail-Konto für die Antwort.");
    const stored = await prisma.mailMessage.findFirst({
      where: { organizationId: input.organizationId, accountId: input.accountId, providerMessageId: input.providerMessageId },
    });
    const sent = await runMailAppleScript(
      replySendScript({
        accountId: context.appleId,
        mailbox: stored?.folder || "INBOX",
        messageId: input.providerMessageId,
        body: input.body,
        replyAll: input.replyAll === true,
        sender: context.account.emailAddress,
      }),
      40_000,
    );
    if (!sent.ok) return failed(sent.error);
    return this.confirmSent(context.appleId, input.subject, input.to, sent.output);
  }

  async forward(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    const context = input.accountId ? await accountContext(input.organizationId, input.accountId) : null;
    if (!context) return failed("Kein Apple-Mail-Konto für die Weiterleitung.");
    const stored = await prisma.mailMessage.findFirst({
      where: { organizationId: input.organizationId, accountId: input.accountId, providerMessageId: input.providerMessageId },
    });
    const sent = await runMailAppleScript(
      forwardSendScript({
        accountId: context.appleId,
        mailbox: stored?.folder || "INBOX",
        messageId: input.providerMessageId,
        to: input.to,
        body: input.body,
        sender: context.account.emailAddress,
      }),
      40_000,
    );
    if (!sent.ok) return failed(sent.error);
    return this.confirmSent(context.appleId, input.subject, input.to, sent.output);
  }

  async markRead(organizationId: string, accountId: string, providerMessageId: string) {
    const context = await accountContext(organizationId, accountId);
    if (!context) return { ok: false, executed: false, reason: "ACCOUNT_NOT_CONNECTED" };
    const stored = await prisma.mailMessage.findFirst({
      where: { organizationId, accountId, providerMessageId },
    });
    const result = await runMailAppleScript(
      markReadScript(context.appleId, stored?.folder || "INBOX", providerMessageId),
      20_000,
    );
    return { ok: result.ok, executed: result.ok, reason: result.ok ? "gelesen" : result.error };
  }

  async archive(organizationId: string, accountId: string, providerMessageId: string) {
    const context = await accountContext(organizationId, accountId);
    if (!context) return { ok: false, executed: false, reason: "ACCOUNT_NOT_CONNECTED" };
    const stored = await prisma.mailMessage.findFirst({
      where: { organizationId, accountId, providerMessageId },
    });
    const result = await runMailAppleScript(
      archiveScript(context.appleId, stored?.folder || "INBOX", providerMessageId),
      20_000,
    );
    if (!result.ok) return { ok: false, executed: false, reason: result.error };
    if (result.output.includes("missing-archive")) {
      return { ok: false, executed: false, reason: "Kein Archiv-Postfach." };
    }
    return { ok: true, executed: true, reason: "archiviert" };
  }

  async attachmentMetadata(organizationId: string, accountId: string, providerMessageId: string): Promise<MailProviderAttachment[]> {
    const message = await this.getMessage(organizationId, accountId, providerMessageId);
    return message?.attachments ?? [];
  }

  async downloadAttachment(input: {
    organizationId: string;
    accountId: string;
    providerMessageId: string;
    attachmentId: string;
  }) {
    const context = await accountContext(input.organizationId, input.accountId);
    if (!context) return { ok: false, reason: "ACCOUNT_NOT_CONNECTED" };
    const stored = await prisma.mailMessage.findFirst({
      where: {
        organizationId: input.organizationId,
        accountId: input.accountId,
        providerMessageId: input.providerMessageId,
      },
      include: { attachments: true },
    });
    const meta = stored?.attachments.find((item) => item.contentId === input.attachmentId || item.filename === input.attachmentId);
    const filename = meta?.filename || "anhang";
    if ((meta?.size ?? 0) > 8 * 1024 * 1024) return { ok: false, filename, reason: "too-large" };
    const destination = path.join(os.tmpdir(), `nova-mail-${Date.now()}-${filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60)}`);
    const saved = await runMailAppleScript(
      saveAttachmentScript({
        accountId: context.appleId,
        mailbox: stored?.folder || "INBOX",
        messageId: input.providerMessageId,
        attachmentId: input.attachmentId,
        destination,
      }),
      25_000,
    );
    if (!saved.ok || saved.output.trim() !== "ok" || !fs.existsSync(destination)) {
      return { ok: false, filename, reason: saved.ok ? "download" : saved.error };
    }
    try {
      const bytes = fs.readFileSync(destination);
      if (bytes.length > 8 * 1024 * 1024) return { ok: false, filename, reason: "too-large" };
      return { ok: true, bytes, filename, mimeType: meta?.mimeType || "application/octet-stream", reason: "ok" };
    } finally {
      fs.rmSync(destination, { force: true });
    }
  }

  private async confirmSent(appleId: string, subject: string, recipient: string, scriptOutput: string): Promise<MailSendResult> {
    const accepted = /true/i.test(scriptOutput);
    const lookup = await runMailAppleScript(sentLookupScript(appleId, subject, recipient), 25_000);
    const messageId = lookup.ok ? lookup.output.trim() : "";
    const status = deliveryFromVerification(accepted, Boolean(messageId));
    if (status !== "VERIFIED") {
      return failed("Die Nachricht ist nicht im Ordner Gesendet bestätigt.");
    }
    return {
      ok: true,
      executed: true,
      mock: false,
      status: "VERIFIED",
      messageId,
      reason: "Im Ordner Gesendet gefunden.",
    };
  }
}

export async function inspectOutgoingMessage(outgoingId: string): Promise<{ ok: boolean; recipients: number; attachments: number }> {
  const result = await runMailAppleScript(outgoingCheckScript(outgoingId), 15_000);
  if (!result.ok) return { ok: false, recipients: 0, attachments: 0 };
  const [recipients, attachments] = result.output.trim().split(":");
  return { ok: true, recipients: Number(recipients) || 0, attachments: Number(attachments) || 0 };
}

export async function discardOutgoingMessage(outgoingId: string): Promise<boolean> {
  const result = await runMailAppleScript(discardOutgoingScript(outgoingId), 15_000);
  return result.ok && result.output.includes("ok");
}
