export type ReviewCommand =
  | { kind: "approve"; alsoSend: boolean }
  | { kind: "continue" }
  | { kind: "changes"; instruction: string }
  | { kind: "reject" }
  | { kind: "cancel" };

const NEW_TASK =
  /^(recherchiere|suche\b|schreib|oeffne|öffne|bau|erstelle|importier|schick mir|was ist|wer ist|leg[e]? an|mach )/i;

export function classifyReviewUtterance(text: string): ReviewCommand | null {
  const value = text.trim().replace(/\s+/g, " ");
  if (!value || value.length > 160) return null;
  if (NEW_TASK.test(value)) return null;

  if (/^(abbrechen|stopp|stop|lass es|vergiss es)[.!]?$/i.test(value)) {
    return { kind: "cancel" };
  }
  if (/^(ablehnen|nein danke|das will ich nicht)[.!]?$/i.test(value)) {
    return { kind: "reject" };
  }
  if (/^(nochmal|nicht gut|änder\w*|aender\w*|bitte änder\w*|bitte aender\w*|funktioniert nicht|anders machen)\b/i.test(value)) {
    return { kind: "changes", instruction: value };
  }
  if (/^(weiter)[.!]?$/i.test(value)) {
    return { kind: "continue" };
  }
  if (/^(senden|schick(e)?( es)? ab|raus damit)[.!]?$/i.test(value)) {
    return { kind: "approve", alsoSend: true };
  }
  if (/^(passt|passt so|freigeben|frei geben|genehmigt|okay|ok|gut so|einverstanden)([,.]?\s+senden)?[.!]?$/i.test(value)) {
    return { kind: "approve", alsoSend: /\bsenden\b/i.test(value) };
  }
  return null;
}
