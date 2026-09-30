import crypto from "node:crypto";

/**
 * Wirkung der Mails: Jede Kampagnen-Mail bekommt einen eigenen Kurzlink auf den rankPilot Check
 * (https://rankpilot.de/check?c=<code>). Die Webseite speichert den Code beim Check als utm_content
 * (utm_source=nova), die App liefert die Checks über GET /api/internal/nova/checks.
 * Einrichtung: RANKPILOT_CHECKS_TOKEN in NOVAs .env (derselbe Schlüssel wie ADS_CHECK_INGEST_SECRET der App);
 * RANKPILOT_APP_URL optional (Standard https://app.rankpilot.de).
 */

export const CHECK_URL = process.env.NOVA_CHECK_URL?.trim() || "https://rankpilot.de/check";

export function neuerCheckCode(): string {
  return crypto.randomBytes(5).toString("hex").slice(0, 8);
}

/** Ersetzt jeden nackten Check-Link im Text durch den Kurzlink mit Code. Gibt den Link zurück, wenn einer vorkam. */
export function markiereCheckLinks(text: string, code: string): { text: string; link: string | null } {
  const link = `${CHECK_URL}?c=${code}`;
  const muster = new RegExp(`${CHECK_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\w/?#-])`, "g");
  if (!muster.test(text)) return { text, link: null };
  return { text: text.replace(muster, link), link };
}

export function codeAusLink(link: string | null | undefined): string | null {
  return link?.match(/[?&]c=([a-z0-9]{4,16})\b/)?.[1] ?? null;
}

export type NovaCheck = {
  id: string;
  code: string | null;
  status: string;
  website: string | null;
  ort: string | null;
  konto_angelegt: boolean;
  erstellt: string;
};

export type CheckQuelle = (seit: Date) => Promise<{ eingerichtet: false; grund: string } | { eingerichtet: true; checks: NovaCheck[] }>;

export const appCheckQuelle: CheckQuelle = async (seit) => {
  const token = process.env.RANKPILOT_CHECKS_TOKEN?.trim();
  if (!token) return { eingerichtet: false, grund: "RANKPILOT_CHECKS_TOKEN fehlt in NOVAs .env" };
  const basis = process.env.RANKPILOT_APP_URL?.trim() || "https://app.rankpilot.de";
  const response = await fetch(`${basis}/api/internal/nova/checks?seit=${encodeURIComponent(seit.toISOString())}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return { eingerichtet: false, grund: "die App kennt die Abfrage noch nicht (nicht live)" };
  if (!response.ok) return { eingerichtet: false, grund: `die App antwortet mit ${response.status}` };
  const data = (await response.json()) as { checks?: NovaCheck[] };
  return { eingerichtet: true, checks: data.checks ?? [] };
};
