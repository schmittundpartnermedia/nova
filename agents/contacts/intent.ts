export function detectContactIntent(text: string): "create" | "search" | "list" | false {
  const value = text.trim();
  if (!value) return false;
  if (/\b(neues ticket|ticket anlegen|ticket erstell)\b/i.test(value)) return false;
  if (/\b(?:speicher(?:e)?|leg(?:e)?)\b(?:\s+\S+){0,4}\s+kontakt\b/i.test(value)) return "create";
  if (/\b(?:neuer kontakt|kontakt anlegen)\b/i.test(value)) return "create";
  if (/\b(kontakt (?:von|zu)|zeig(?:e)? kontakt|such(?:e)? kontakt)\b/i.test(value)) return "search";
  if (/\bwer ist\b/i.test(value)) {
    if (/\b(derzeit|aktuell|heute|jetzt|gerade|kanzler|präsident|praesident|minister)\b/i.test(value)) return false;
    return "search";
  }
  if (/\b(welche kontakte|kontaktliste|alle kontakte|meine kontakte|zeig(?:e)?(?:\s+mir)?(?:\s+meine)?\s+kontakte|kontakte\s+(?:anzeigen|auflisten|zeigen))\b/i.test(value)) {
    return "list";
  }
  if (/\bkontakte?\b/i.test(value) && /\b(zeig|liste|welche|meine|alle|übersicht|uebersicht)\b/i.test(value)) {
    return "list";
  }
  return false;
}

function cleanNamePart(value: string): string {
  return value
    .replace(/^[\s:–—,-]+/, "")
    .replace(/^(?:an|für|fuer|namens|mit)\s*:?\s+/i, "")
    .replace(/[,.!?;:]+$/g, "")
    .trim();
}

export function guessPersonName(text: string): { firstName: string; lastName: string; email?: string } {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch?.[0];
  const withoutEmail = email ? text.replace(email, " ") : text;

  const afterKontakt = withoutEmail.match(
    /kontakt(?:\s+(?:anlegen|speichern|für|fuer|von|an))?\s*:?\s+(.+)/i,
  );
  if (afterKontakt?.[1]) {
    const names = cleanNamePart(afterKontakt[1])
      .split(/[\s,]+/)
      .map(cleanNamePart)
      .filter((part) => part && !/^(anlegen|speichern|neuen?|kontakt)$/i.test(part));
    if (names[0]) {
      return { firstName: names[0], lastName: names.slice(1).join(" "), email };
    }
  }

  const wer = withoutEmail.match(/wer ist\s+([A-ZÄÖÜ][\p{L}'-]+)(?:\s+([A-ZÄÖÜ][\p{L}'-]+))?/u);
  if (wer?.[1]) return { firstName: wer[1], lastName: wer[2] ?? "", email };

  const parts = withoutEmail
    .replace(/\b(?:speicher(?:e)?|leg(?:e)?|kontakt|anlegen|neuen?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .map(cleanNamePart)
    .filter(Boolean);

  return { firstName: parts[0] || "Unbekannt", lastName: parts.slice(1).join(" "), email };
}
