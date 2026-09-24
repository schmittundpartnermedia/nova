export function detectCalendarIntent(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (!/\b(termine?|kalender|meetings?)\b/i.test(value)) {
    return /\b(trag(?:e)?\s+ein|leg(?:e)?\s+einen?\s+termin)\b/i.test(value);
  }
  return /\b(anleg|erstell|trag|einlad|liste|übersicht|welche\s+termine|wann|leg(?:e)?|absag|lösch|stornier|verschieb)\b/i.test(
    value,
  );
}
