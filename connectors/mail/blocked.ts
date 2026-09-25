import { BaseMailProvider } from "@/connectors/mail/base";
import type { MailSendResult } from "@/types/connectors";

export class BlockedMailProvider extends BaseMailProvider {
  id = "mail-blocked";
  mock = false;

  async authStatus() {
    return { connected: false, reason: "ACCOUNT_NOT_CONNECTED" };
  }

  async healthCheck() {
    return { ok: false, live: false, reason: "ACCOUNT_NOT_CONNECTED" };
  }

  async send(): Promise<MailSendResult> {
    return {
      ok: false,
      executed: false,
      mock: false,
      status: "FAILED",
      reason: "Kein Mailkonto verbunden. Es wurde nichts versendet.",
    };
  }
}
