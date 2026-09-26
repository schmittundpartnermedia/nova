import net from "node:net";
import path from "node:path";
import type { MailAutomationState } from "@/lib/mail/apple";

const SOCKET = path.join(process.cwd(), ".nova", "mail-consent.sock");

export function requestMailConsentFromNovaApp(): Promise<MailAutomationState | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (state: MailAutomationState | null) => {
      if (settled) return;
      settled = true;
      resolve(state);
    };
    const client = net.createConnection(SOCKET);
    const timer = setTimeout(() => {
      client.destroy();
      finish(null);
    }, 15 * 60 * 1000);
    let raw = "";
    client.on("connect", () => {
      client.write('{"cmd":"mail.consent"}\n');
    });
    client.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    client.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    client.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(raw) as { state?: string };
        const state = parsed.state;
        if (state === "granted" || state === "denied" || state === "required" || state === "unavailable") {
          finish(state);
          return;
        }
      } catch {
        finish(null);
        return;
      }
      finish(null);
    });
  });
}
