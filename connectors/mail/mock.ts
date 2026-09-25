import { BaseMailProvider } from "@/connectors/mail/base";
import type { MailSendInput, MailSendResult } from "@/types/connectors";

/** Nur für Tests. Der produktive Registry-Pfad liefert diesen Provider nicht. */
export class MockMailProvider extends BaseMailProvider {
  id = "mock-mail";
  mock = true;

  async send(_input: MailSendInput): Promise<MailSendResult> {
    return {
      ok: false,
      executed: false,
      mock: true,
      status: "FAILED",
      reason: "Kein echter Mail-Connector verbunden. Versand wurde nicht ausgeführt. Entwürfe bleiben vorbereitet.",
    };
  }
}
