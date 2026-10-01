/** Allgemeine Helfer für Mail-Adressen und Mail-Verläufe (unabhängig davon, wie die Mail gelesen wird). */

export function parseMailAddress(raw: string): { name?: string; email: string } {
  const text = raw.trim();
  const wrapped = text.match(/^(.*)<([^>]+)>$/);
  if (wrapped) {
    const name = wrapped[1]?.trim().replace(/^"|"$/g, "");
    return { name: name || undefined, email: wrapped[2]!.trim() };
  }
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) return { email, name: text === email ? undefined : text.replace(email, "").trim() || undefined };
  return { email: "" };
}

/**
 * Automatisch erzeugte Mail (Abwesenheitsnotiz, Autoresponder) nach RFC 3834 und den üblichen Kopfzeilen.
 * Eingabe: Kopfzeilen als Zuordnung Name (klein) → Wert.
 */
export function istAutomatischeAntwort(kopf: Record<string, string | undefined>): boolean {
  const auto = (kopf["auto-submitted"] ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (kopf["x-autoreply"] !== undefined || kopf["x-autorespond"] !== undefined) return true;
  return /^(auto_reply|auto-reply)$/i.test((kopf["precedence"] ?? "").trim());
}

/** Rückläufer (Unzustellbar-Meldung): kommt vom Mailsystem, nicht von einem Menschen. */
export function istRuecklaeufer(absender: string): boolean {
  const lokal = (parseMailAddress(absender).email.split("@")[0] ?? "").toLowerCase();
  return lokal === "mailer-daemon" || lokal === "postmaster" || lokal === "mail-daemon";
}

/** Message-IDs aus In-Reply-To/References, ohne spitze Klammern, klein geschrieben. */
export function verlaufsKennungen(...kopfzeilen: string[]): string[] {
  const ids = kopfzeilen.join(" ").match(/<[^<>\s]+>|[^\s<>]+@[^\s<>]+/g) ?? [];
  return Array.from(new Set(ids.map(normalisiereMessageId).filter(Boolean)));
}

export function normalisiereMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, "").toLowerCase();
}
