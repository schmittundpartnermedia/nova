export function detectTicketIntent(text: string): boolean {
  return /\b(neues ticket|ticket anlegen|ticket erstell|öffne ein ticket|ticket für)\b/i.test(text.trim());
}

export function guessTicketTitle(text: string): string {
  const cleaned = text
    .replace(/nova[,.\s]*/i, "")
    .replace(/\b(neues ticket|ticket anlegen|ticket erstell|öffne ein ticket|ticket für)\b/gi, "")
    .trim();
  return (cleaned || "Ticket").slice(0, 160);
}
