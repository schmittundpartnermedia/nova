/**
 * Konten, die NOVA steuern darf (Entwurf + Versand).
 * check@b2b-rankpilot.de: eigene Domain für Kaltakquise (Kunden-Kampagnen, Tagesbetrieb), damit rankpilot.de geschützt bleibt.
 */
export const DEFAULT_STEERABLE_MAIL_ADDRESSES = [
  "info@elevum.io",
  "joachim@rankpilot.de",
  "check@b2b-rankpilot.de",
] as const;

export function steerableMailAddresses(): string[] {
  const fromEnv = (process.env.NOVA_MAIL_STEERABLE ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length) return Array.from(new Set(fromEnv));
  return [...DEFAULT_STEERABLE_MAIL_ADDRESSES];
}

export function isSteerableMailAddress(email: string | null | undefined): boolean {
  const value = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!value) return false;
  return steerableMailAddresses().includes(value);
}

export function filterSteerableMailAccounts<T extends { emailAddress: string }>(accounts: T[]): T[] {
  return accounts.filter((account) => isSteerableMailAddress(account.emailAddress));
}
