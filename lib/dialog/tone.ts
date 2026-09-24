export type UserTone = "neutral" | "warm" | "playful" | "sarcastic" | "annoyed" | "tired" | "urgent";

const SARCASTIC_RE =
  /\b(na\s+super|na\s+toll|wieder\s+mal|als\s+ob|sicherlich|ja\s+klar|ironisch|sarkasmus)\b|😉|😏/i;
const ANNOYED_RE =
  /\b(jetzt\s+reicht|es\s+reicht|nervt|genug\s+jetzt|hör\s+auf|lass\s+das|verdammt|mist|sauer|genervt)\b/i;
const PLAYFUL_RE = /\b(spaß|scherz|witz|haha|hihi|lol|spaßeshalber)\b|😂|😄|🤣/i;
const TIRED_RE = /\b(müde|keine\s+lust|später|ich\s+kann\s+nicht\s+mehr|erschöpft|feierabend\s+im\s+kopf)\b/i;
const URGENT_RE = /\b(sofort|dringend|schnell|asap|jetzt\s+gleich|eilig)\b/i;

export function detectUserTone(text: string): UserTone {
  const value = text.trim();
  if (!value) return "neutral";
  if (ANNOYED_RE.test(value)) return "annoyed";
  if (SARCASTIC_RE.test(value)) return "sarcastic";
  if (PLAYFUL_RE.test(value)) return "playful";
  if (TIRED_RE.test(value)) return "tired";
  if (URGENT_RE.test(value)) return "urgent";
  if (/^(hallo|hi|hey|danke|schönen\s+feierabend)/i.test(value)) return "warm";
  return "neutral";
}

export function toneInstruction(tone: UserTone): string {
  if (tone === "sarcastic") {
    return "Der User ist sarkastisch oder ironisch. Nimm den Unterton mit, erkläre ihn nicht, werde nicht belehrend.";
  }
  if (tone === "annoyed") {
    return "Der User ist genervt oder ärgerlich. Kurz, sachlich, ohne Floskeln und ohne Aufheiterung.";
  }
  if (tone === "playful") {
    return "Der User macht Spaß. Spiel mit, bleib auf Augenhöhe, werde nicht albern-assistenzhaft.";
  }
  if (tone === "tired") {
    return "Der User ist müde. Wenig Worte, keine extra Aufgaben anbieten.";
  }
  if (tone === "urgent") {
    return "Der User hat Eile. Direkt zur Sache, keine Warm-up-Sätze.";
  }
  if (tone === "warm") {
    return "Der User ist warm oder sozial. Erwidere menschlich.";
  }
  return "";
}
