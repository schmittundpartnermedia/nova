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
  if (/\b(neue|ungelesene|wichtige)\b/i.test(text) && /\bmails?\b/i.test(text)) {
    return { kind: "inbox", statusMessage: "Ich schaue ins Postfach." };
  }
  if (/\bwas ist neu\b/i.test(text) && /\bmail/i.test(text)) {
    return { kind: "inbox", statusMessage: "Ich schaue ins Postfach." };
  }
  if (/\b(antwort(e|en)?|entwurf)\b/i.test(text) && /\b(mail|schreib|dass)\b/i.test(text)) {
    return { kind: "draft", statusMessage: "Ich bereite einen Entwurf vor." };
  }
  const from = text.match(/\b(?:von|hat)\s+([A-ZÄÖÜ][\wäöüÄÖÜß.-]+(?:\s+[A-ZÄÖÜ][\wäöüÄÖÜß.-]+)?)/);
  if (from && /\b(mail|geschrieben|antwort)\b/i.test(text)) {
    return { kind: "search", query: from[1], statusMessage: "Ich suche den Verlauf." };
  }
  if (/\bmails?\b/i.test(text)) {
    const query = text.replace(/\b(such(e|en)?|zeig(e)?|mir|die|mails?|von|über|ueber|letzte[nrs]? woche)\b/gi, " ").replace(/\s+/g, " ").trim();
    return { kind: "search", query: query || text, statusMessage: "Ich suche in den Mails." };
  }
  return { kind: "none" };
}
