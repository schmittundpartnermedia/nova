export function detectTicketIntent(text: string): "create" | "list" | false {
  const value = text.trim();
  if (!value) return false;
  if (/\b(neues ticket|ticket anlegen|ticket erstell|öffne ein ticket|ticket für)\b/i.test(value)) return "create";
  if (/\btickets?\b/i.test(value) && /\b(welche|zeig|liste|meine|offene|alle|habe ich|gibt es)\b/i.test(value)) {
    return "list";
  }
  return false;
}

export function guessTicketTitle(text: string): string {
  const cleaned = text
    .replace(/nova[,.\s]*/i, "")
    .replace(/\b(neues ticket|ticket anlegen|ticket erstell|öffne ein ticket|ticket für)\b/gi, " ")
    .replace(/^(?:\s*(?:für|fuer|ein|eine|einen|den|die|das)\s+)+/i, "")
    .trim();
  return (cleaned || "Ticket").slice(0, 160);
}
