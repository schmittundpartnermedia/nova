import { BaseMailProvider } from "@/connectors/mail/base";
import type { MailSendInput, MailSendResult } from "@/types/connectors";

/** Passwort-SMTP ist kein produktiver NOVA-Weg. Versand läuft nur über OAuth-Tokens. */
export function smtpConfigured(): boolean {
  return false;
}

export function passwordSmtpEnabled(): boolean {
  return false;
}

export class SmtpMailProvider extends BaseMailProvider {
  id = "smtp-mail";
  mock = false;

  async authStatus() {
    return { connected: false, reason: "ACCOUNT_NOT_CONNECTED" };
  }

  async healthCheck() {
    return { ok: false, live: false, reason: "ACCOUNT_NOT_CONNECTED" };
  }

  async send(_input: MailSendInput): Promise<MailSendResult> {
    return {
      ok: false,
      executed: false,
      mock: false,
      status: "FAILED",
      reason: "Mailversand braucht eine OAuth-Verbindung. Es wurde nichts versendet.",
    };
  }

  async reply(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    return this.send(input);
  }
}
