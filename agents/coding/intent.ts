import type { CodingIntent, CodingIntentKind } from "@/lib/coding/types";

const STOP_RE = /^(nova[,.\s]*)?(stopp?|stop|abbrechen|hör\s*auf|hoer\s*auf)\.?$/i;

const WEBSITE_RE =
  /(?:bau(?:e|en)?|erstell(?:e|en)?|mach(?:e|en)?).{0,40}(?:website|webseite|homepage|landing\s*page|testseite)|neue\s+(?:website|webseite)|website\s+für/i;

const FIX_RE =
  /(?:prüf(?:e|en)?|check(?:e|en)?).*(?:fehler|bugs?|lint|typecheck|build)|beheb(?:e|en)?\s+(?:die\s+)?fehler|fix(?:e|en)?\s+(?:die\s+)?(?:fehler|bugs?)|reparier/i;

const IMPLEMENT_RE =
  /lass\s+cursor|cursor\s+das\s+umsetz|implementier|änder(?:e|n)?\s+.*(?:startseite|website|seite|code|hero)|setz(?:e|en)?\s+.*(?:um|in\s+cursor)|coding[-\s]?auftrag|(?:schreib(?:e|en)?|leg(?:e|en)?|erstell(?:e|en)?|anleg(?:e|en)?).{0,80}(?:datei|file|\.txt|\.md|\.ts|\.tsx|\.js|\.json)|(?:datei|file).{0,40}(?:anleg|erstell|schreib)/i;

const PROJECT_HINTS = [
  { key: "rankpilot", re: /rank\s*pilot/i },
  { key: "planexus", re: /planexus/i },
  { key: "elevum", re: /elevum/i },
  { key: "nova", re: /\bnova[- ]?(?:projekt|repo|repository|codebase|code)\b/i },
];

export function detectCodingIntent(userRequest: string): CodingIntent {
  const text = userRequest.trim();
  if (STOP_RE.test(text)) {
    return { kind: "cancel", userCommissioned: true, statusMessage: "Ich breche ab." };
  }

  const projectHint = PROJECT_HINTS.find((item) => item.re.test(text))?.key;

  if (WEBSITE_RE.test(text)) {
    return {
      kind: "website_build",
      userCommissioned: true,
      statusMessage: "Ich plane die Website.",
      projectHint,
    };
  }

  if (FIX_RE.test(text) && (projectHint || /cursor|code|projekt|repo/i.test(text))) {
    return {
      kind: "fix",
      userCommissioned: true,
      statusMessage: "Ich prüfe den Code und lasse Fehler beheben.",
      projectHint,
    };
  }

  if (IMPLEMENT_RE.test(text) || (projectHint && /änder|bau|umsetz|startseite|hero/i.test(text))) {
    return {
      kind: "implement",
      userCommissioned: true,
      statusMessage: "Cursor setzt den Auftrag um.",
      projectHint,
    };
  }

  return { kind: "none", userCommissioned: false, statusMessage: "" };
}

export function isCodingRequest(userRequest: string): boolean {
  const kind: CodingIntentKind = detectCodingIntent(userRequest).kind;
  return kind !== "none";
}
