export type SpeechAct = "greeting" | "wish" | "thanks" | "farewell" | "ack" | "question" | "task";

export type DialogMoveKind = "social" | "ask" | "work";

export type DialogMove = {
  kind: DialogMoveKind;
  act: SpeechAct;
  socialAck: boolean;
};

const NOVA_PREFIX = /^(nova[,.\s:-]*)+/i;

const GREETING_RE = /^(hallo|hi+|hey|moin|servus|guten\s+(morgen|tag|abend)|na\s+du)[.!?]*$/i;
const WISH_RE =
  /^((ich\s+wünsche\s+dir\s+)?(einen?\s+)?(recht\s+)?(schönen?\s+)?(feierabend|wochenende|tag|abend)|gute\s+nacht|gute\s+besserung|viel\s+erfolg|gesundheit)[.!?]*$/i;
const THANKS_RE = /^(danke(?:schön)?|dankeschön|thanks|thx|merci)([,.\s]+(dir|nova|schön|sehr|dir\s+auch)?)?[.!?]*$/i;
const FAREWELL_RE = /^(tschüss|tschüß|ciao|bye|bis\s+(bald|dann|morgen|gleich)|mach['’]?s\s+gut)[.!?]*$/i;
const ACK_RE = /^(ok|okay|alles\s+klar|verstanden|super|passt|genau|ja)[.!?]*$/i;

const HAS_WISH_RE =
  /\b((ich\s+wünsche\s+dir\s+)?(einen?\s+)?schönen?\s+(feierabend|tag|abend)|schönes\s+wochenende|gute\s+nacht|gute\s+besserung|viel\s+erfolg)\b/i;
const HAS_GREETING_RE = /\b(hallo|hi+|hey|moin|servus|guten\s+(morgen|tag|abend))\b/i;
const HAS_THANKS_RE = /\b(danke(?:schön)?|dankeschön|thanks|thx|merci)\b/i;
const HAS_FAREWELL_RE = /\b(tschüss|tschüß|ciao|bye|bis\s+(bald|dann|morgen)|mach['’]?s\s+gut)\b/i;

const DEFINITION_RE = /\bwas\s+(bedeutet|heißt|ist)\b/i;
const QUESTION_RE =
  /\b(was|wer|wo|wann|wie|welche[srn]?|warum|wieso|weshalb|woher|wonach)\b|\?/;
const WORK_RE =
  /\b(importier|lern(?:e|en)?|recherch|analysier|bau(?:e|en)?|änder(?:e|n)?|implementier|merk(?:e)?\s+dir|erstell|finde|such(?:e)?)\b/i;

const SOCIAL_STRIP = [
  NOVA_PREFIX,
  /\bnova\b/gi,
  /\b(hallo|hi+|hey|moin|servus|guten\s+(morgen|tag|abend)|na\s+du)\b/gi,
  /\b((ich\s+wünsche\s+dir\s+)?(einen?\s+)?(recht\s+)?schönen?\s+(feierabend|tag|abend)|schönes\s+wochenende|gute\s+nacht|gute\s+besserung|viel\s+erfolg|gesundheit)\b/gi,
  /\b(danke(?:schön)?|dankeschön|thanks|thx|merci)(\s+(dir|nova|schön|sehr|dir\s+auch))?\b/gi,
  /\b(tschüss|tschüß|ciao|bye|bis\s+(bald|dann|morgen|gleich)|mach['’]?s\s+gut)\b/gi,
  /\b(ok|okay|alles\s+klar|verstanden|super|passt)\b/gi,
];

function bare(text: string): string {
  return text.replace(NOVA_PREFIX, "").replace(/[\s]+/g, " ").trim();
}

function residualAfterSocial(text: string): string {
  let value = text;
  for (const re of SOCIAL_STRIP) {
    value = value.replace(re, " ");
  }
  return value.replace(/[\s,.;:!?/-]+/g, " ").trim();
}

function hasInformationalResidue(residue: string): boolean {
  if (!residue) return false;
  if (residue.length <= 2) return false;
  return DEFINITION_RE.test(residue) || QUESTION_RE.test(residue) || WORK_RE.test(residue) || residue.split(" ").length >= 4;
}

function socialActOf(text: string): SpeechAct | null {
  const value = bare(text);
  if (!value) return null;
  if (GREETING_RE.test(value)) return "greeting";
  if (WISH_RE.test(value)) return "wish";
  if (THANKS_RE.test(value)) return "thanks";
  if (FAREWELL_RE.test(value)) return "farewell";
  if (ACK_RE.test(value)) return "ack";
  if (HAS_WISH_RE.test(value) && !hasInformationalResidue(residualAfterSocial(value))) return "wish";
  if (HAS_GREETING_RE.test(value) && !hasInformationalResidue(residualAfterSocial(value))) return "greeting";
  if (HAS_THANKS_RE.test(value) && !hasInformationalResidue(residualAfterSocial(value))) return "thanks";
  if (HAS_FAREWELL_RE.test(value) && !hasInformationalResidue(residualAfterSocial(value))) return "farewell";
  return null;
}

export function detectDialogMove(userRequest: string): DialogMove {
  const text = userRequest.trim();
  if (!text) return { kind: "ask", act: "question", socialAck: false };

  if (DEFINITION_RE.test(text) && hasInformationalResidue(residualAfterSocial(text))) {
    return {
      kind: "ask",
      act: "question",
      socialAck: HAS_WISH_RE.test(text) || HAS_GREETING_RE.test(text) || HAS_THANKS_RE.test(text),
    };
  }

  const act = socialActOf(text);
  if (act) {
    return { kind: "social", act, socialAck: false };
  }

  const residue = residualAfterSocial(text);
  const socialAck =
    HAS_WISH_RE.test(text) || HAS_GREETING_RE.test(text) || HAS_THANKS_RE.test(text) || HAS_FAREWELL_RE.test(text);

  if (WORK_RE.test(residue)) {
    return { kind: "work", act: "task", socialAck };
  }
  if (hasInformationalResidue(residue) || QUESTION_RE.test(text)) {
    return { kind: "ask", act: "question", socialAck };
  }
  if (socialAck) {
    return { kind: "social", act: HAS_WISH_RE.test(text) ? "wish" : HAS_THANKS_RE.test(text) ? "thanks" : "greeting", socialAck: false };
  }
  return { kind: "ask", act: "question", socialAck: false };
}

export function isPureSocial(userRequest: string): boolean {
  return detectDialogMove(userRequest).kind === "social";
}

export function dialogInstruction(move: DialogMove): string {
  if (move.kind === "social") {
    if (move.act === "wish") {
      return "Dieser Zug ist ein Wunsch. Erwidere ihn menschlich. Erkläre keine Wörter. Knowledge und Memory nicht vorlesen.";
    }
    if (move.act === "thanks") {
      return "Dieser Zug ist Dank. Erwidere knapp und menschlich. Keine Erklärung, kein Statusbericht.";
    }
    if (move.act === "greeting") {
      return "Dieser Zug ist eine Begrüßung. Antworte auf Augenhöhe, nicht als Assistenten-Vorstellung.";
    }
    if (move.act === "farewell") {
      return "Dieser Zug ist ein Abschied. Erwidere menschlich und kurz.";
    }
    return "Dieser Zug ist sozial. Erwidere menschlich. Knowledge nicht vorlesen, außer der User fragt.";
  }
  if (move.socialAck) {
    return "Zuerst den sozialen Teil kurz erwidern, dann die Sache beantworten. Wenn Knowledge passt, nenne Datei und Stelle im Satz.";
  }
  return "Wenn Knowledge-Treffer passen, nutze sie und nenne Dateiname und Stelle natürlich im Satz. Erfinde keine Quellen.";
}
