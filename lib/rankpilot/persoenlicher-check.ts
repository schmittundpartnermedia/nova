/**
 * Persönlicher rankPilot-Check vor der Mail: NOVA startet über den internen Eingang der Webseite
 * (POST /api/internal/check-start, Schlüssel RANKPILOT_CHECKS_TOKEN = ADS_CHECK_INGEST_SECRET) einen Check für den
 * Betrieb, wartet, bis er fertig ist, und liest den Bericht (öffentlich, ohne Kontaktdaten: /api/check-share).
 * Solche Checks verschicken selbst keine Mail – der Link kommt mit Joachims persönlicher Mail.
 */

export const WEBSITE = (process.env.RANKPILOT_WEBSITE_URL?.trim() || "https://rankpilot.de").replace(/\/$/, "");

export type CheckStart = { siteUrl: string; city: string; keyword: string; email: string; name: string; company?: string; code?: string };
export type CheckStand = { runStatus: "pending" | "running" | "success" | "failed"; checkId: string };
export type CheckBericht = { report?: Record<string, unknown>; visibility?: Record<string, unknown> };

export type CheckDienst = {
  /** ortUnbekannt: Der Check kennt den Ort nicht (auch nicht den Hauptort) – es wurde nichts gestartet. */
  starte(input: CheckStart): Promise<{ checkId: string; wiederverwendet: boolean } | { ortUnbekannt: string }>;
  stand(checkId: string): Promise<CheckStand>;
  bericht(checkId: string): Promise<CheckBericht>;
};

export function checkLink(checkId: string): string {
  return `${WEBSITE}/check/r/${checkId}`;
}

function schluessel(): string {
  const token = process.env.RANKPILOT_CHECKS_TOKEN?.trim();
  if (!token) throw new Error("RANKPILOT_CHECKS_TOKEN fehlt in NOVAs .env – ohne ihn kann ich keinen Check starten.");
  return token;
}

async function antwort<T>(res: Response, was: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${was}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

export const webseitenCheck: CheckDienst = {
  async starte(input) {
    const res = await fetch(`${WEBSITE}/api/internal/check-start`, {
      method: "POST",
      headers: { authorization: `Bearer ${schluessel()}`, "content-type": "application/json" },
      body: JSON.stringify({
        siteUrl: input.siteUrl,
        city: input.city,
        keyword: input.keyword,
        code: input.code,
        contact: { name: input.name, email: input.email, company: input.company },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 422) return { ortUnbekannt: input.city };
    const d = await antwort<{ checkId: string; wiederverwendet: boolean }>(res, "Check-Start");
    return { checkId: d.checkId, wiederverwendet: d.wiederverwendet };
  },
  async stand(checkId) {
    const res = await fetch(`${WEBSITE}/api/internal/check-start?id=${encodeURIComponent(checkId)}`, {
      headers: { authorization: `Bearer ${schluessel()}` },
      signal: AbortSignal.timeout(30_000),
    });
    return antwort<CheckStand>(res, "Check-Stand");
  },
  async bericht(checkId) {
    const res = await fetch(`${WEBSITE}/api/check-share?id=${encodeURIComponent(checkId)}`, { signal: AbortSignal.timeout(30_000) });
    const d = await antwort<{ check: CheckBericht }>(res, "Check-Bericht");
    return d.check;
  },
};

const globalRef = globalThis as unknown as { __novaCheckDienst?: CheckDienst };

export function checkDienst(): CheckDienst {
  return globalRef.__novaCheckDienst ?? webseitenCheck;
}

/** Tests setzen einen Dienst im Speicher ein; nie die echte Webseite. */
export function setzeCheckDienst(dienst: CheckDienst | null): void {
  globalRef.__novaCheckDienst = dienst ?? undefined;
}
