import type {
  MailActionResult,
  MailListQuery,
  MailProvider,
  MailProviderAttachment,
  MailProviderDraft,
  MailProviderFolder,
  MailProviderMessage,
  MailSendInput,
  MailSendResult,
} from "@/types/connectors";

const blocked = (reason: string): MailSendResult => ({
  ok: false,
  executed: false,
  mock: false,
  status: "FAILED",
  reason,
});

const action = (reason: string): MailActionResult => ({ ok: false, executed: false, reason });

export abstract class BaseMailProvider implements MailProvider {
  abstract id: string;
  abstract mock: boolean;

  async authStatus(_organizationId: string): Promise<{ connected: boolean; reason: string }> {
    return { connected: false, reason: "Kein Mailkonto verbunden." };
  }

  async listAccounts(_organizationId: string): Promise<Array<{ id: string; emailAddress: string; displayName?: string }>> {
    return [];
  }

  async listFolders(_organizationId: string, _accountId: string): Promise<MailProviderFolder[]> {
    return [];
  }

  async listMessages(_query: MailListQuery): Promise<MailProviderMessage[]> {
    return [];
  }

  async getMessage(_organizationId: string, _accountId: string, _providerMessageId: string): Promise<MailProviderMessage | null> {
    return null;
  }

  async getThread(_organizationId: string, _threadId: string): Promise<MailProviderMessage[] | null> {
    return null;
  }

  async search(_organizationId: string, _query: string): Promise<MailProviderMessage[]> {
    return [];
  }

  async createDraft(input: MailSendInput): Promise<MailProviderDraft> {
    return {
      providerMessageId: `local-draft-${Date.now()}`,
      providerThreadId: input.threadId,
      subject: input.subject,
      body: input.body,
    };
  }

  async updateDraft(_organizationId: string, draftId: string, patch: Partial<MailSendInput>): Promise<MailProviderDraft> {
    return {
      providerMessageId: draftId,
      subject: patch.subject ?? "",
      body: patch.body ?? "",
    };
  }

  async sendDraft(_organizationId: string, _draftId: string): Promise<MailSendResult> {
    return blocked("Versand ist für diesen Connector nicht verfügbar.");
  }

  async send(_input: MailSendInput): Promise<MailSendResult> {
    return blocked("Versand ist für diesen Connector nicht verfügbar.");
  }

  async reply(_input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    return blocked("Antwortversand ist für diesen Connector nicht verfügbar.");
  }

  async forward(_input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    return blocked("Weiterleiten ist für diesen Connector nicht verfügbar.");
  }

  async markRead(_organizationId: string, _accountId: string, _providerMessageId: string): Promise<MailActionResult> {
    return action("Gelesen-Markierung ist nicht verfügbar.");
  }

  async archive(_organizationId: string, _accountId: string, _providerMessageId: string): Promise<MailActionResult> {
    return action("Archivieren ist nicht verfügbar.");
  }

  async attachmentMetadata(_organizationId: string, _accountId: string, _providerMessageId: string): Promise<MailProviderAttachment[]> {
    return [];
  }

  async downloadAttachment(_input: {
    organizationId: string;
    accountId: string;
    providerMessageId: string;
    attachmentId: string;
  }): Promise<{ ok: boolean; bytes?: Buffer; filename?: string; mimeType?: string; reason: string }> {
    return { ok: false, reason: "Anhang konnte nicht geladen werden." };
  }

  async healthCheck(_organizationId: string, _accountId?: string): Promise<{ ok: boolean; live: boolean; reason: string }> {
    return { ok: false, live: false, reason: "Mailprovider ist nicht verbunden." };
  }

  async getMessageUrl(_organizationId: string, _messageId: string): Promise<string | null> {
    return null;
  }
}
