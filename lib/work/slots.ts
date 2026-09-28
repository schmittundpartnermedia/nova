export type ActiveWorkStatus =
  | "clarifying"
  | "ready"
  | "executing"
  | "waiting_approval"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled";

export type ActiveWorkDomain =
  | "mail"
  | "calendar"
  | "contact"
  | "ticket"
  | "project"
  | "watch"
  | "computer"
  | "coding"
  | "knowledge"
  | "research"
  | "generic";

export type SlotDef = {
  key: string;
  question: string;
  required: boolean;
};

export const DOMAIN_SLOTS: Record<ActiveWorkDomain, SlotDef[]> = {
  mail: [
    { key: "from", question: "Von welchem Mailkonto soll ich senden?", required: false },
    { key: "to", question: "An wen soll die Mail gehen?", required: false },
    { key: "subject", question: "Welchen Betreff soll die Mail haben?", required: false },
    { key: "body", question: "Was soll in der Mail stehen?", required: false },
  ],
  calendar: [
    { key: "when", question: "Wann soll der Termin sein? (Tag und Uhrzeit)", required: true },
    { key: "title", question: "Wie soll der Termin heißen?", required: true },
  ],
  contact: [
    { key: "name", question: "Wie heißt der Kontakt?", required: true },
    { key: "email", question: "Welche E-Mail-Adresse hat der Kontakt?", required: false },
  ],
  ticket: [
    { key: "title", question: "Wie soll das Ticket heißen?", required: true },
    { key: "description", question: "Was gehört in die Beschreibung?", required: false },
  ],
  project: [{ key: "name", question: "Wie soll das Projekt heißen?", required: true }],
  watch: [],
  computer: [
    { key: "goal", question: "Was genau soll ich auf dem Mac erledigen?", required: true },
  ],
  coding: [
    { key: "path", question: "In welchem Projektpfad soll ich arbeiten?", required: true },
    { key: "task", question: "Was genau soll ich im Code umsetzen?", required: true },
  ],
  knowledge: [{ key: "query", question: "Wonach soll ich im Wissen suchen?", required: true }],
  research: [{ key: "query", question: "Was soll ich recherchieren?", required: true }],
  generic: [{ key: "goal", question: "Was genau soll ich erledigen?", required: true }],
};

export function missingRequiredSlots(
  domain: ActiveWorkDomain,
  slots: Record<string, string | null | undefined>,
): string[] {
  return DOMAIN_SLOTS[domain]
    .filter((slot) => slot.required && !String(slots[slot.key] ?? "").trim())
    .map((slot) => slot.key);
}

export function nextSlotQuestion(
  domain: ActiveWorkDomain,
  missing: string[],
): string | null {
  if (!missing.length) return null;
  const def = DOMAIN_SLOTS[domain].find((slot) => slot.key === missing[0]);
  return def?.question ?? `Bitte noch angeben: ${missing[0]}.`;
}

export function parseSlotValue(key: string, userRequest: string): string | null {
  const text = userRequest.trim();
  if (!text) return null;
  if (key === "when" || key === "title" || key === "name" || key === "goal" || key === "task" || key === "query" || key === "description" || key === "body" || key === "path" || key === "email" || key === "to" || key === "from" || key === "subject") {
    // Free answers while clarifying: take the whole utterance unless it is clearly cancel.
    if (/^(abbrechen|cancel|stopp|vergiss)\.?$/i.test(text)) return null;
    return text;
  }
  return text;
}
