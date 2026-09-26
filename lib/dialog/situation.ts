export type SituationSnapshot = {
  pendingApproval: { actionType: string; hardBlocked: boolean } | null;
  approvalCreatedAt: Date | null;
  reviewOpenedAt: Date | null;
  activeReview: boolean;
  resumableComputer: boolean;
  lastActivityType: string | null;
};

export function approvalSupersedesReview(input: {
  approvalAt: Date | null;
  reviewAt: Date | null;
  confirmsApproval: boolean;
}): boolean {
  if (!input.confirmsApproval || !input.approvalAt || !input.reviewAt) return false;
  return input.approvalAt.getTime() > input.reviewAt.getTime();
}

export type SituationDecision =
  | { kind: "confirm-pending" }
  | { kind: "reject-pending" }
  | { kind: "cancel-active" }
  | { kind: "status" }
  | { kind: "resume-computer" }
  | { kind: "revise-mail" }
  | { kind: "none" };

const YES =
  /^(?:nova[,.\s]*)?(?:ja|ja bitte|ja genau|okay|ok|passt|einverstanden|mach das|genau so|freigeben)[.!]?$/i;
const YES_SEND =
  /^(?:nova[,.\s]*)?(?:ja[,.]?\s+)?(?:senden|schick(?:e)? (?:sie|die mail|es)|mail raus)[.!]?$/i;
const NO =
  /^(?:nova[,.\s]*)?(?:nein|nein danke|ablehnen|nicht senden|das will ich nicht)[.!]?$/i;
const STOP =
  /^(?:nova[,.\s]*)?(?:stopp?|stop|abbrechen|hör auf|hoer auf|lass es|vergiss es)[.!]?$/i;
const STATUS =
  /^(?:nova[,.\s]*)?(?:wie ist der stand|was ist der (?:aktuelle |heutige )?stand|wie ist der aktuelle stand|wie weit bist du|woran arbeitest du|was läuft(?: gerade)?|was laeuft(?: gerade)?|status)[.!?]*$/i;
const RESUME = /^(?:nova[,.\s]*)?(?:mach weiter|setz(?:e)? fort)[.!]?$/i;
const REVISE = /^(?:nova[,.\s]*)?(?:änder\w*|aender\w*|bitte änder\w*|bitte aender\w*)\b/i;

function spoken(text: string): string {
  return text.replace(/[„“”"«»']/g, "").replace(/\s+/g, " ").trim();
}

export function classifySituationTurn(text: string, situation: SituationSnapshot): SituationDecision {
  const value = spoken(text);
  if (!value) return { kind: "none" };
  if (STOP.test(value)) return { kind: "cancel-active" };
  if (STATUS.test(value)) return { kind: "status" };
  if (situation.pendingApproval && (YES.test(value) || YES_SEND.test(value))) {
    return { kind: "confirm-pending" };
  }
  if (situation.pendingApproval && NO.test(value)) return { kind: "reject-pending" };
  if (RESUME.test(value) && situation.resumableComputer && !situation.activeReview) {
    return { kind: "resume-computer" };
  }
  if (/^(?:nova[,.\s]*)?(?:änder\w*|aender\w*|bitte änder\w*|bitte aender\w*).*\b(?:entwurf|e-?mail)\b/i.test(value)) {
    return { kind: "revise-mail" };
  }
  if (
    REVISE.test(value) &&
    (situation.lastActivityType === "communication" || situation.lastActivityType === "mail") &&
    !situation.activeReview
  ) {
    return { kind: "revise-mail" };
  }
  return { kind: "none" };
}
