import nodemailer from "nodemailer";
import { BaseMailProvider } from "@/connectors/mail/base";
import { redactSecrets } from "@/lib/computer/redaction";
import type { MailSendInput, MailSendResult } from "@/types/connectors";

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

function smtpPort(): number {
  const raw = Number(process.env.SMTP_PORT ?? 587);
  return Number.isFinite(raw) && raw > 0 ? raw : 587;
}

export class SmtpMailProvider extends BaseMailProvider {
  id = "smtp-mail";
  mock = false;

  async authStatus() {
    return {
      connected: smtpConfigured(),
      reason: smtpConfigured() ? "SMTP konfiguriert, Postfachlesen fehlt." : "ACCOUNT_NOT_CONNECTED",
    };
  }

  async healthCheck() {
    return {
      ok: smtpConfigured(),
      live: smtpConfigured(),
      reason: smtpConfigured() ? "SMTP erreichbar konfiguriert." : "ACCOUNT_NOT_CONNECTED",
    };
  }

  async send(input: MailSendInput): Promise<MailSendResult> {
    if (!smtpConfigured()) {
      return {
        ok: false,
        executed: false,
        mock: false,
        status: "FAILED",
        reason: "SMTP ist nicht konfiguriert. Es wurde nichts versendet.",
      };
    }
    const host = process.env.SMTP_HOST!.trim();
    const from = process.env.SMTP_FROM!.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS ?? "";
    const port = smtpPort();
    const secure = process.env.SMTP_SECURE === "1" || port === 465;
    try {
      const transport = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
      });
      const info = await transport.sendMail({
        from,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.body,
        html: input.html,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      const accepted = Array.isArray(info.accepted) ? info.accepted.length > 0 : Boolean(info.messageId);
      if (!accepted) {
        return { ok: false, executed: false, mock: false, status: "FAILED", reason: "SMTP hat den Versand nicht bestätigt." };
      }
      return {
        ok: true,
        executed: true,
        mock: false,
        status: "VERIFIED",
        messageId: info.messageId,
        reason: `E-Mail an ${input.to} vom SMTP-Server angenommen.`,
      };
    } catch (error) {
      const reason = redactSecrets(error instanceof Error ? error.message : "SMTP-Fehler");
      return { ok: false, executed: false, mock: false, status: "FAILED", reason: `SMTP war nicht erreichbar. ${reason}`.slice(0, 240) };
    }
  }

  async reply(input: MailSendInput & { providerMessageId: string }): Promise<MailSendResult> {
    const subject = /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`;
    return this.send({ ...input, subject });
  }
}
