import type { MailProvider, MailSendInput, MailSendResult } from "@/types/connectors";

export class MockMailProvider implements MailProvider {
  id = "mock-mail";

  async send(_input: MailSendInput): Promise<MailSendResult> {
    return {
      ok: false,
      executed: false,
      mock: true,
      reason:
        "Kein echter Mail-Connector verbunden. Versand wurde nicht ausgeführt. Entwürfe bleiben vorbereitet.",
    };
  }

  async search(_organizationId: string, _query: string): Promise<unknown[]> {
    return [];
  }

  async getThread(_organizationId: string, _threadId: string): Promise<unknown | null> {
    return null;
  }

  async getMessageUrl(_organizationId: string, _messageId: string): Promise<string | null> {
    return null;
  }
}
