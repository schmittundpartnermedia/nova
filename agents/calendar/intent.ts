export function detectCalendarIntent(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (
    /\b(apple|google|outlook|icloud)\b.{0,40}\bkalender\b/i.test(value) ||
    /\bkalender\b.{0,40}\b(apple|google|outlook|icloud)\b/i.test(value) ||
    /\bexterne[rnms]?\s+kalender\b/i.test(value)
  ) {
    return true;
  }
  if (/\bsag(?:e|t|en)?\b.{0,80}\bab\b/i.test(value) && /\b(termine?|kalender)\b/i.test(value)) return true;
  if (!/\b(termine?|kalender|meetings?)\b/i.test(value)) {
    return /\b(trag(?:e)?\s+ein|leg(?:e)?\s+einen?\s+termin)\b/i.test(value);
  }
  if (/\b(meetings?|besprechung(?:en)?)\b/i.test(value)) {
    return /\b(anleg|erstell|trag|einlad|liste|übersicht|welche|wann|leg(?:e)?|absag|lösch|stornier|verschieb|stehen|ansteh)\b/i.test(
      value,
    );
  }
  return /\b(anleg|erstell|trag|einlad|liste|übersicht|welche\s+termine|wann|leg(?:e)?|absag|lösch|stornier|verschieb|verbunden|verbindung)\b/i.test(
    value,
  );
}
