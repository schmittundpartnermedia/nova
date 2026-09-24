import { spawn } from "node:child_process";
import type { MailProvider, MailSendInput, MailSendResult } from "@/types/connectors";

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

function smtpPort(): number {
  const raw = Number(process.env.SMTP_PORT ?? 587);
  return Number.isFinite(raw) && raw > 0 ? raw : 587;
}

export class SmtpMailProvider implements MailProvider {
  id = "smtp-mail";

  async send(input: MailSendInput): Promise<MailSendResult> {
    if (!smtpConfigured()) {
      return {
        ok: false,
        executed: false,
        mock: false,
        reason: "SMTP ist nicht konfiguriert. Es wurde nichts versendet.",
      };
    }
    const host = process.env.SMTP_HOST!.trim();
    const from = process.env.SMTP_FROM!.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS ?? "";
    const port = smtpPort();
    const secure = process.env.SMTP_SECURE === "1" || port === 465;
    const scheme = secure ? "smtps" : "smtp";
    const url = `${scheme}://${host}:${port}`;
    const rfc = [`From: ${from}`, `To: ${input.to}`, `Subject: ${input.subject}`, "", input.body, ""].join("\r\n");

    const args = ["--url", url, "--mail-from", from, "--mail-rcpt", input.to, "-T", "-"];
    if (user) {
      args.push("--user", `${user}:${pass}`);
    }
    if (!secure) args.push("--ssl-reqd");

    try {
      const code = await runCurl(args, rfc);
      if (code !== 0) {
        return {
          ok: false,
          executed: false,
          mock: false,
          reason: "SMTP hat den Versand abgelehnt. Die Mail ist nicht raus.",
        };
      }
      return {
        ok: true,
        executed: true,
        mock: false,
        reason: `E-Mail an ${input.to} über SMTP angenommen.`,
      };
    } catch {
      return {
        ok: false,
        executed: false,
        mock: false,
        reason: "SMTP war nicht erreichbar. Es wurde nichts versendet.",
      };
    }
  }

  async search(): Promise<unknown[]> {
    return [];
  }

  async getThread(): Promise<unknown | null> {
    return null;
  }

  async getMessageUrl(): Promise<string | null> {
    return null;
  }
}

function runCurl(args: string[], stdin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["-sS", "--max-time", "20", ...args], { stdio: ["pipe", "ignore", "ignore"] });
    child.stdin.write(stdin);
    child.stdin.end();
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
