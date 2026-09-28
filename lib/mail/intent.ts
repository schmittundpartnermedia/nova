export type MailIntent =
  | { kind: "none" }
  | { kind: "inbox"; statusMessage: string }
  | { kind: "search"; query: string; statusMessage: string }
  | { kind: "show"; query: string; statusMessage: string }
  | { kind: "draft"; statusMessage: string }
  | { kind: "send-confirm"; statusMessage: string };

export function detectMailIntent(userRequest: string): MailIntent {
  const text = userRequest.trim();
  if (!text) return { kind: "none" };
  if (/^(ja[,.]?\s+)?(senden|schick(e)? (sie|die mail|es)|mail raus)\.?$/i.test(text)) {
    return { kind: "send-confirm", statusMessage: "Ich prüfe die Freigabe." };
  }
  if (/\b(neue|neueste|neuesten|neuer|ungelesene|wichtige)\b/i.test(text) && /\bmails?\b/i.test(text)) {
    return { kind: "inbox", statusMessage: "Ich schaue ins Postfach." };
  }
  if (/\b(liest|lies|lese|vor)\b/i.test(text) && /\b(neuest|letzt|mails?)\b/i.test(text)) {
    return { kind: "inbox", statusMessage: "Ich schaue ins Postfach." };
  }
  if (/\bwas ist neu\b/i.test(text) && /\bmail/i.test(text)) {
    return { kind: "inbox", statusMessage: "Ich schaue ins Postfach." };
  }
  if (/\b(?:änder\w*|aender\w*|korrigier\w*|ergänz\w*|erganz\w*|überarbeit\w*|ueberarbeit\w*)\b/i.test(text) && /\bentwurf\b/i.test(text)) {
    return { kind: "draft", statusMessage: "Ich ändere den offenen Entwurf." };
  }
  if (/\b(?:entwurf|mailentwurf|e-?mail-?entwurf)\b/i.test(text) && !/\b(?:such(?:e|en)?|finde|zeig(?:e)?|liste)\b/i.test(text)) {
    return { kind: "draft", statusMessage: "Ich bereite einen Entwurf vor." };
  }
  if (/\b(?:antwort(?:e|en)?)\b/i.test(text) && /\b(?:mail|schreib|dass)\b/i.test(text)) {
    return { kind: "draft", statusMessage: "Ich bereite einen Entwurf vor." };
  }
  if (/\b(?:schreib(?:e|en)?|verfass(?:e|en)?)\b/i.test(text) && /\b(?:e-?mail|mail)\b/i.test(text)) {
    return { kind: "draft", statusMessage: "Ich bereite einen Entwurf vor." };
  }
  if (
    /\b(?:schick(?:e|en)?|send(?:e|en)?|versend(?:e|en)?)\b/i.test(text) &&
    /\b(?:e-?mail|mail)\b/i.test(text) &&
    !/^(ja[,.]?\s+)?(senden|schick(e)? (sie|die mail|es)|mail raus)\.?$/i.test(text)
  ) {
    return { kind: "draft", statusMessage: "Ich bereite einen Entwurf vor." };
  }
  const from = text.match(/\b(?:von|hat)\s+([A-ZÄÖÜ][\wäöüÄÖÜß.-]+(?:\s+[A-ZÄÖÜ][\wäöüÄÖÜß.-]+)?)/);
  if (from && /\b(?:e-?mails?|mails?|geschrieben|antwort)\b/i.test(text)) {
    return { kind: "search", query: from[1], statusMessage: "Ich suche den Verlauf." };
  }
  if (/\b(erkläre|erklär|was bedeutet|wie funktioniert|konzept)\b/i.test(text)) return { kind: "none" };
  const mentionsMailbox = /\b(?:e-?mails?|mails?|postfach)\b/i.test(text);
  const asksToFind = /\b(?:such(?:e|en|t)?|finde(?:n|t)?|zeig(?:e|en|t)?|liste(?:n|t)?|übersicht|uebersicht|von|über|ueber|letzte[nrs]?)\b/i.test(text);
  if (mentionsMailbox && asksToFind) {
    const query = text
      .replace(
        /\b(?:such(?:e|en|t)?|zeig(?:e|en|t)?|mir|die|der|das|eine?|e-?mails?|mails?|postfach|von|über|ueber|im|nach|letzte[nrs]?(?:\s+woche)?|finde(?:n|t)?|liste(?:n|t)?|übersicht|uebersicht)\b/gi,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
    return { kind: "search", query: query || text, statusMessage: "Ich suche in den Mails." };
  }
  return { kind: "none" };
}
