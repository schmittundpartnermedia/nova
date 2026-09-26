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
  if (/\b(welche kontakte|kontaktliste|alle kontakte)\b/i.test(value)) return "list";
  return false;
}

export function guessPersonName(text: string): { firstName: string; lastName: string } {
  const named = text.match(
    /kontakt(?:\s+(?:anlegen|speichern|für|von))?\s+([A-ZÄÖÜ][a-zäöüß]+)(?:\s+([A-ZÄÖÜ][a-zäöüß]+))?/i,
  );
  if (named?.[1]) {
    return { firstName: named[1], lastName: named[2] ?? "" };
  }
  const wer = text.match(/wer ist\s+([A-ZÄÖÜ][a-zäöüß]+)(?:\s+([A-ZÄÖÜ][a-zäöüß]+))?/i);
  if (wer?.[1]) return { firstName: wer[1], lastName: wer[2] ?? "" };
  const parts = text.replace(/speicher(?:e)?|leg(?:e)?|kontakt|an|anlegen|neuen?/gi, "").trim().split(/\s+/);
  return { firstName: parts[0] || "Unbekannt", lastName: parts.slice(1).join(" ") };
}
