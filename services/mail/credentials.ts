import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type MailSecret = {
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};

const root = path.join(process.cwd(), ".nova", "mail-credentials");

function masterKey(): Buffer {
  const fromEnv = process.env.NOVA_MAIL_KEY?.trim();
  if (fromEnv) return scryptSync(fromEnv, "nova-mail-v1", 32);
  const file = path.join(process.cwd(), ".nova", "mail.key");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return scryptSync(fs.readFileSync(file, "utf8"), "nova-mail-v1", 32);
}

export async function storeMailSecret(organizationId: string, secret: MailSecret): Promise<string> {
  const ref = randomBytes(16).toString("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(secret), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const dir = path.join(root, organizationId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, ref), Buffer.concat([iv, tag, body]), { mode: 0o600 });
  return ref;
}

export async function readMailSecret(organizationId: string, credentialRef: string): Promise<MailSecret | null> {
  if (!/^[a-f0-9]{32}$/.test(credentialRef)) return null;
  const file = path.join(root, organizationId, credentialRef);
  if (!file.startsWith(path.join(root, organizationId))) return null;
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  return JSON.parse(json) as MailSecret;
}

export async function deleteMailSecret(organizationId: string, credentialRef: string): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(credentialRef)) return;
  const file = path.join(root, organizationId, credentialRef);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
