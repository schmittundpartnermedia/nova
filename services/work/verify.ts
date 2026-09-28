import type { OrbState } from "@/types";

/** DONE nur, wenn eine Aktion wirklich belegt ist. Gesprächsantworten nutzen IDLE/DONE ohne Evidence-Claim. */
export function orbForOutcome(input: {
  verified: boolean;
  waitingApproval?: boolean;
  failed?: boolean;
  working?: boolean;
}): OrbState {
  if (input.waitingApproval) return "WAITING_FOR_APPROVAL";
  if (input.failed) return "ERROR";
  if (input.working) return "WORKING";
  if (input.verified) return "DONE";
  return "DONE";
}

export function statusForOutcome(input: {
  verified: boolean;
  waitingApproval?: boolean;
  failed?: boolean;
  working?: boolean;
  fallback: string;
}): string {
  if (input.waitingApproval) return "Freigabe erforderlich.";
  if (input.failed) return "Nicht erledigt.";
  if (input.working) return "Läuft.";
  if (input.verified) return "Erledigt und geprüft.";
  return input.fallback;
}

export function claimDoneOnlyIfVerified(verified: boolean, message: string): string {
  if (verified) return message;
  if (/erledigt|fertig|versendet|angelegt|geöffnet/i.test(message) && !/nicht|kein|warte|fehlt/i.test(message)) {
    return `${message} (noch nicht verifiziert.)`;
  }
  return message;
}
