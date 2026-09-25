import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { deleteMailSecret, storeMailSecret, type MailOAuthProvider, type MailSecret } from "@/services/mail/credentials";

const stateRoot = path.join(process.cwd(), ".nova", "mail-oauth-state");

type PendingAuth = {
  organizationId: string;
  provider: MailOAuthProvider;
  verifier: string;
  createdAt: string;
};

const PROVIDERS: Record<
  MailOAuthProvider,
  { authorize: string; token: string; scopes: string[]; label: string }
> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "https://mail.google.com/"],
    label: "Google",
  },
  microsoft: {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "email", "offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"],
    label: "Microsoft",
  },
};

export function oauthClientId(provider: MailOAuthProvider): string | null {
  const key = provider === "google" ? "NOVA_GOOGLE_OAUTH_CLIENT_ID" : "NOVA_MICROSOFT_OAUTH_CLIENT_ID";
  const value = process.env[key]?.trim();
  return value || null;
}

export function optionalClientSecret(provider: MailOAuthProvider): string | null {
  const key = provider === "google" ? "NOVA_GOOGLE_OAUTH_CLIENT_SECRET" : "NOVA_MICROSOFT_OAUTH_CLIENT_SECRET";
  const value = process.env[key]?.trim();
  return value || null;
}

export function oauthConfigured(provider: MailOAuthProvider): boolean {
  return Boolean(oauthClientId(provider));
}

export function anyMailOauthConfigured(): boolean {
  return oauthConfigured("google") || oauthConfigured("microsoft");
}

export function mailRedirectUri(): string {
  return process.env.NOVA_MAIL_OAUTH_REDIRECT_URI?.trim() || "http://127.0.0.1:3100/api/mail/oauth/callback";
}

export function mailboxTransport(provider: MailOAuthProvider) {
  if (provider === "google") {
    return { imapHost: "imap.gmail.com", imapPort: 993, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true };
  }
  return { imapHost: "outlook.office365.com", imapPort: 993, smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecure: false };
}

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function beginMailOAuth(organizationId: string, provider: MailOAuthProvider): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  assertOrganizationId(organizationId);
  const clientId = oauthClientId(provider);
  if (!clientId) return { ok: false, reason: "PROVIDER_OAUTH_NOT_CONFIGURED" };
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const pending: PendingAuth = { organizationId, provider, verifier, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(stateRoot, state), JSON.stringify(pending), { mode: 0o600 });
  const config = PROVIDERS[provider];
  const url = new URL(config.authorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", mailRedirectUri());
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (provider === "google") url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return { ok: true, url: url.toString() };
}

export async function completeMailOAuth(input: { code: string; state: string }): Promise<{ ok: true; emailAddress: string } | { ok: false; reason: string }> {
  const file = path.join(stateRoot, input.state);
  if (!/^[a-f0-9]{32}$/.test(input.state) || !fs.existsSync(file)) return { ok: false, reason: "OAuth-Status ungültig." };
  const pending = JSON.parse(fs.readFileSync(file, "utf8")) as PendingAuth;
  fs.unlinkSync(file);
  if (Date.now() - new Date(pending.createdAt).getTime() > 10 * 60 * 1000) return { ok: false, reason: "OAuth-Status abgelaufen." };
  const clientId = oauthClientId(pending.provider);
  if (!clientId) return { ok: false, reason: "PROVIDER_OAUTH_NOT_CONFIGURED" };
  const config = PROVIDERS[pending.provider];
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: mailRedirectUri(),
    code_verifier: pending.verifier,
  });
  const secret = optionalClientSecret(pending.provider);
  if (secret) body.set("client_secret", secret);
  const tokenResponse = await fetch(config.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResponse.ok) return { ok: false, reason: "Der Anbieter hat die Autorisierung abgelehnt." };
  const token = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
  if (!token.access_token) return { ok: false, reason: "Kein Zugriffstoken erhalten." };
  const profile = await providerProfile(pending.provider, token.access_token, token.id_token);
  if (!profile.email) return { ok: false, reason: "Der Anbieter hat keine E-Mail-Adresse geliefert." };
  const mailSecret: MailSecret = {
    provider: pending.provider,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    scopes: (token.scope ?? config.scopes.join(" ")).split(/\s+/),
    providerAccountId: profile.id,
    emailAddress: profile.email.toLowerCase(),
  };
  const credentialRef = await storeMailSecret(pending.organizationId, mailSecret);
  const existing = await prisma.mailAccount.findFirst({
    where: { organizationId: pending.organizationId, emailAddress: mailSecret.emailAddress },
  });
  if (existing?.credentialRef && existing.credentialRef !== credentialRef) {
    await deleteMailSecret(pending.organizationId, existing.credentialRef);
  }
  await prisma.mailAccount.upsert({
    where: { organizationId_emailAddress: { organizationId: pending.organizationId, emailAddress: mailSecret.emailAddress } },
    create: {
      organizationId: pending.organizationId,
      provider: pending.provider,
      emailAddress: mailSecret.emailAddress,
      displayName: profile.name,
      status: "connected",
      capabilities: JSON.stringify(["MAIL_READ", "MAIL_SEARCH", "MAIL_DRAFT", "MAIL_SEND"]),
      credentialRef,
    },
    update: {
      provider: pending.provider,
      displayName: profile.name,
      status: "connected",
      credentialRef,
      lastError: null,
    },
  });
  return { ok: true, emailAddress: mailSecret.emailAddress };
}

export async function refreshMailAccessToken(secret: MailSecret): Promise<MailSecret | null> {
  if (!secret.refreshToken) return null;
  const clientId = oauthClientId(secret.provider);
  if (!clientId) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: secret.refreshToken,
  });
  const clientSecret = optionalClientSecret(secret.provider);
  if (clientSecret) body.set("client_secret", clientSecret);
  const response = await fetch(PROVIDERS[secret.provider].token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;
  const token = (await response.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };
  if (!token.access_token) return null;
  return {
    ...secret,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? secret.refreshToken,
    expiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
  };
}

async function providerProfile(provider: MailOAuthProvider, accessToken: string, idToken?: string): Promise<{ email?: string; name?: string; id?: string }> {
  const fromId = emailFromIdToken(idToken);
  if (provider === "google") {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { email: fromId };
    const profile = (await response.json()) as { email?: string; name?: string; sub?: string };
    return { email: profile.email ?? fromId, name: profile.name, id: profile.sub };
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { email: fromId };
  const profile = (await response.json()) as { mail?: string; userPrincipalName?: string; displayName?: string; id?: string };
  return { email: profile.mail || profile.userPrincipalName || fromId, name: profile.displayName, id: profile.id };
}

function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
    return json.email || json.preferred_username;
  } catch {
    return undefined;
  }
}
