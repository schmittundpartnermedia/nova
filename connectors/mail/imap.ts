import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { BaseMailProvider } from "@/connectors/mail/base";
import { loadAccountSecret } from "@/services/mail/accounts";
import { mailboxTransport } from "@/services/mail/oauth";
import { redactSecrets } from "@/lib/computer/redaction";
import type { MailProviderMessage, MailSendInput, MailSendResult } from "@/types/connectors";
import type { MailSecret } from "@/services/mail/credentials";

function safeReason(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : "Mailprovider nicht erreichbar").slice(0, 180);
}

async function withImap<T>(secret: MailSecret, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const mailbox = mailboxTransport(secret.provider);
  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: true,
    auth: { user: secret.emailAddress, accessToken: secret.accessToken },
    logger: false,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function probeImap(secret: MailSecret): Promise<{ ok: boolean; reason: string }> {
  try {
    await withImap(secret, async (client) => {
      await client.mailboxOpen("INBOX");
    });
    return { ok: true, reason: "Postfach verbunden." };
  } catch (error) {
    return { ok: false, reason: safeReason(error) };
  }
}

export class ImapSmtpMailProvider extends BaseMailProvider {
  id = "imap-smtp";
  mock = false;

  async authStatus(organizationId: string) {
    const { prisma } = await import("@/lib/prisma");
    const account = await prisma.mailAccount.findFirst({ where: { organizationId, status: "connected", provider: "imap" } });
    return { connected: Boolean(account), reason: account ? "verbunden" : "ACCOUNT_NOT_CONNECTED" };
  }

  async listAccounts(organizationId: string) {
    const { listMailAccounts } = await import("@/services/mail/accounts");
    const accounts = await listMailAccounts(organizationId);
    return accounts.map((item) => ({ id: item.id, emailAddress: item.emailAddress, displayName: item.displayName ?? undefined }));
  }

  async healthCheck(organizationId: string, accountId?: string) {
    if (!accountId) return { ok: false, live: false, reason: "ACCOUNT_NOT_CONNECTED" };
    const loaded = await loadAccountSecret(organizationId, accountId);
    if (!loaded) return { ok: false, live: false, reason: "ACCOUNT_NOT_CONNECTED" };
    const probed = await probeImap(loaded.secret);
    return { ok: probed.ok, live: probed.ok, reason: probed.ok ? "ok" : "PROVIDER_UNAVAILABLE" };
  }

  async listFolders(organizationId: string, accountId: string) {
    const loaded = await loadAccountSecret(organizationId, accountId);
    if (!loaded) return [];
    return withImap(loaded.secret, async (client) => {
      const boxes = await client.list();
      return boxes.map((box) => ({
        id: box.path,
        name: box.name,
        role: box.path.toUpperCase() === "INBOX" ? ("inbox" as const) : ("other" as const),
      }));
    });
  }

  async listMessages(query: { organizationId: string; accountId: string; folder?: string; sinceUid?: number; limit?: number }) {
    const loaded = await loadAccountSecret(query.organizationId, query.accountId);
    if (!loaded) return [];
    return withImap(loaded.secret, async (client) => {
      const lock = await client.getMailboxLock(query.folder ?? "INBOX");
      try {
        const range = query.sinceUid ? `${query.sinceUid + 1}:*` : "1:*";
        const out: MailProviderMessage[] = [];
        for await (const message of client.fetch(range, { envelope: true, source: true, uid: true, flags: true })) {
          if (out.length >= (query.limit ?? 40)) break;
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          out.push(toProviderMessage(parsed, message.uid, String(client.mailbox && typeof client.mailbox === "object" ? client.mailbox.uidValidity : ""), query.folder ?? "INBOX", Boolean(message.flags?.has("\\Seen"))));
        }
        return out;
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(organizationId: string, accountId: string, providerMessageId: string) {
    const rows = await this.listMessages({ organizationId, accountId, limit: 80 });
    return rows.find((item) => item.providerMessageId === providerMessageId) ?? null;
  }

  async getThread(organizationId: string, threadId: string) {
    const { prisma } = await import("@/lib/prisma");
    const thread = await prisma.mailThread.findFirst({ where: { organizationId, providerThreadId: threadId } });
    if (!thread) return null;
    const rows = await this.listMessages({ organizationId, accountId: thread.accountId, limit: 80 });
    const matched = rows.filter((item) => item.providerThreadId === threadId);
    return matched.length ? matched : null;
  }

  async search(organizationId: string, query: string) {
    const { prisma } = await import("@/lib/prisma");
    const account = await prisma.mailAccount.findFirst({ where: { organizationId, status: "connected" } });
    if (!account) return [];
    const rows = await this.listMessages({ organizationId, accountId: account.id, limit: 40 });
    const needle = query.toLowerCase();
    return rows.filter((item) => `${item.subject} ${item.textBody} ${item.from.email}`.toLowerCase().includes(needle));
  }

  async send(input: MailSendInput): Promise<MailSendResult> {
    return this.dispatch(input, false);
  }

  async reply(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    const subject = /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`;
    return this.dispatch({ ...input, subject }, true);
  }

  async forward(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    const subject = /^fwd:/i.test(input.subject) ? input.subject : `Fwd: ${input.subject}`;
    return this.dispatch({ ...input, subject }, false);
  }

  private async dispatch(input: MailSendInput, reply: boolean): Promise<MailSendResult> {
    if (!input.accountId) return { ok: false, executed: false, mock: false, status: "FAILED", reason: "Kein Mailkonto." };
    const loaded = await loadAccountSecret(input.organizationId, input.accountId);
    if (!loaded) return { ok: false, executed: false, mock: false, status: "FAILED", reason: "ACCOUNT_NOT_CONNECTED" };
    if (reply && !input.inReplyTo) {
      return { ok: false, executed: false, mock: false, status: "FAILED", reason: "Antwort ohne In-Reply-To wird nicht gesendet." };
    }
    try {
      const mailbox = mailboxTransport(loaded.secret.provider);
      const transport = nodemailer.createTransport({
        host: mailbox.smtpHost,
        port: mailbox.smtpPort,
        secure: mailbox.smtpSecure,
        auth: { type: "OAuth2", user: loaded.secret.emailAddress, accessToken: loaded.secret.accessToken },
      });
      const info = await transport.sendMail({
        from: loaded.account.emailAddress,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.body,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      if (!info.messageId) {
        return { ok: false, executed: false, mock: false, status: "FAILED", reason: "Server hat keine Nachrichten-ID bestätigt." };
      }
      return {
        ok: true,
        executed: true,
        mock: false,
        status: "VERIFIED",
        messageId: info.messageId,
        reason: "Provider hat die Nachricht angenommen.",
      };
    } catch (error) {
      return { ok: false, executed: false, mock: false, status: "FAILED", reason: safeReason(error) };
    }
  }
}

function toProviderMessage(
  parsed: Awaited<ReturnType<typeof simpleParser>>,
  uid: number,
  uidValidity: string,
  folder: string,
  isRead: boolean,
): MailProviderMessage {
  const from = parsed.from?.value[0];
  const mapAddr = (value: { address?: string; name?: string } | undefined) => ({
    email: value?.address?.toLowerCase() ?? "",
    name: value?.name,
  });
  const messageId = parsed.messageId ?? `uid-${uid}`;
  return {
    providerMessageId: messageId,
    providerThreadId: parsed.inReplyTo || messageId,
    internetMessageId: parsed.messageId,
    folder,
    from: mapAddr(from),
    to: (parsed.to && "value" in parsed.to ? parsed.to.value : []).map((item) => mapAddr(item)),
    cc: (parsed.cc && "value" in parsed.cc ? parsed.cc.value : []).map((item) => mapAddr(item)),
    bcc: [],
    subject: parsed.subject ?? "",
    textBody: parsed.text ?? "",
    htmlBody: typeof parsed.html === "string" ? parsed.html : undefined,
    sentAt: parsed.date?.toISOString(),
    receivedAt: parsed.date?.toISOString(),
    isRead,
    direction: "inbound",
    headers: { "message-id": parsed.messageId ?? "" },
    attachments: (parsed.attachments ?? []).map((item, index) => ({
      id: `${uid}-${index}`,
      filename: item.filename ?? `anhang-${index}`,
      mimeType: item.contentType,
      size: item.size,
    })),
    uid,
    uidValidity,
    inReplyTo: parsed.inReplyTo,
    references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [],
  };
}
