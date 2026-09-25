import { BaseMailProvider } from "@/connectors/mail/base";
import type { MailProviderMessage, MailSendInput, MailSendResult } from "@/types/connectors";

/** Testadapter. Nicht über die produktive Registry erreichbar. */
export class FixtureMailProvider extends BaseMailProvider {
  id = "fixture-mail";
  mock = true;
  live = true;
  readonly messages: MailProviderMessage[] = [];
  readonly sent: MailSendInput[] = [];
  readonly files = new Map<string, Buffer>();

  async authStatus() {
    return { connected: this.live, reason: this.live ? "verbunden" : "PROVIDER_UNAVAILABLE" };
  }

  async healthCheck() {
    return { ok: this.live, live: this.live, reason: this.live ? "ok" : "PROVIDER_UNAVAILABLE" };
  }

  async listMessages(query: { sinceUid?: number; limit?: number }) {
    return this.messages
      .filter((item) => query.sinceUid == null || (item.uid ?? 0) > query.sinceUid)
      .slice(0, query.limit ?? 50);
  }

  async getMessage(_organizationId: string, _accountId: string, providerMessageId: string) {
    return this.messages.find((item) => item.providerMessageId === providerMessageId) ?? null;
  }

  async getThread(_organizationId: string, threadId: string) {
    const rows = this.messages.filter((item) => item.providerThreadId === threadId);
    return rows.length ? rows : null;
  }

  async search(_organizationId: string, query: string) {
    const needle = query.toLowerCase();
    return this.messages.filter((item) => `${item.subject} ${item.textBody} ${item.from.email}`.toLowerCase().includes(needle));
  }

  async reply(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    return this.send(input);
  }

  async send(input: MailSendInput): Promise<MailSendResult> {
    if (!this.live) {
      return { ok: false, executed: false, mock: true, status: "FAILED", reason: "PROVIDER_UNAVAILABLE" };
    }
    if (!input.inReplyTo && input.threadId) {
      return { ok: false, executed: false, mock: true, status: "FAILED", reason: "Reply ohne In-Reply-To abgelehnt." };
    }
    this.sent.push(input);
    return {
      ok: true,
      executed: true,
      mock: true,
      status: "VERIFIED",
      messageId: `<verified-${this.sent.length}@fixture>`,
      reason: "Provider hat die Nachricht angenommen.",
    };
  }

  async downloadAttachment(input: { attachmentId: string }) {
    const bytes = this.files.get(input.attachmentId);
    if (!bytes) return { ok: false, reason: "fehlt" };
    return { ok: true, bytes, filename: "angebot.txt", mimeType: "text/plain", reason: "ok" };
  }
}
