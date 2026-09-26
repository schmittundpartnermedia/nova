export type ParsedWhen = {
  startsAt: Date;
  endsAt: Date;
};

const WEEKDAYS = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];

function atTime(day: Date, hours: number, minutes: number): Date {
  const next = new Date(day);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function parseClock(text: string): { hours: number; minutes: number } {
  const umColon = text.match(/\bum\s+(\d{1,2})[:.](\d{2})\b/i);
  if (umColon) {
    return { hours: Math.min(23, Number(umColon[1])), minutes: Math.min(59, Number(umColon[2])) };
  }
  const colon = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    return { hours: Math.min(23, Number(colon[1])), minutes: Math.min(59, Number(colon[2])) };
  }
  const dottedUhr = text.match(/\b(\d{1,2})\.(\d{2})\s*uhr\b/i);
  if (dottedUhr) {
    return { hours: Math.min(23, Number(dottedUhr[1])), minutes: Math.min(59, Number(dottedUhr[2])) };
  }
  const uhr = text.match(/\b(\d{1,2})\s*uhr\b/i);
  if (uhr) {
    return { hours: Math.min(23, Number(uhr[1])), minutes: 0 };
  }
  return { hours: 10, minutes: 0 };
}

export function parseWhen(text: string, now = new Date()): ParsedWhen | null {
  const value = text.trim();
  if (!value) return null;
  const clock = parseClock(value);
  const durationMs = 60 * 60 * 1000;

  const iso = value.match(/\b(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const startsAt = new Date(`${iso[1]}T${(iso[2] ?? String(clock.hours)).padStart(2, "0")}:${(iso[3] ?? String(clock.minutes)).padStart(2, "0")}:00`);
    if (Number.isNaN(startsAt.getTime())) return null;
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
  }

  const german = value.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (german) {
    const year = german[3].length === 2 ? 2000 + Number(german[3]) : Number(german[3]);
    const startsAt = atTime(new Date(year, Number(german[2]) - 1, Number(german[1])), clock.hours, clock.minutes);
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
  }

  const day = new Date(now);
  if (/\bübermorgen\b/i.test(value)) day.setDate(day.getDate() + 2);
  else if (/\bmorgen\b/i.test(value)) day.setDate(day.getDate() + 1);
  else if (/\bheute\b/i.test(value)) {
    /* same day */
  } else {
    const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`, "i").test(value));
    if (weekday < 0) return null;
    const delta = (weekday - day.getDay() + 7) % 7 || 7;
    day.setDate(day.getDate() + delta);
  }

  const startsAt = atTime(day, clock.hours, clock.minutes);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMs) };
}

export function guessTitle(text: string): string {
  const cleaned = text
    .replace(/^(?:nova[,.\s]*)?(?:bitte\s+)?(?:leg(?:e)?|trag(?:e)?|erstell(?:e)?|setz(?:e)?|mach(?:e)?|sag(?:e)?)\b/i, " ")
    .replace(/\b(nova[,.]?\s*)?(trag(?:e)?\s+ein|leg(?:e)?\s+an|erstell(?:e)?|termin|kalender|meeting)\b/gi, " ")
    .replace(/\b(einen|eine|ein|an|für|fuer|den|die|das)\b/gi, " ")
    .replace(/\b(am|um|morgen|übermorgen|heute|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/gi, " ")
    .replace(/\b\d{1,2}[:.]\d{2}(?:\s*uhr)?\b/gi, " ")
    .replace(/\b\d{1,2}\s*uhr\b/gi, " ")
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || "Termin";
}
