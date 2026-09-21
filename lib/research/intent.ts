import type { KnowledgeKind, ResearchIntent, ResearchIntentKind } from "@/lib/research/types";
import type { SearchFreshness } from "@/types/connectors";

const CURRENT_RE =
  /\b(aktuell(?:e|en|er|es)?|heute|gestern|neueste(?:n|r|s)?|jetzt|derzeit|inzwischen|preis(?:e)?|version|news|nachricht(?:en)?|wer ist derzeit|gibt es inzwischen|stand\s+\d|this week|today|latest|current|currently)\b/i;

const REALTIME_RE = /\b(live|echtzeit|just now|breaking|kurs|börse|wetter jetzt)\b/i;

const COMPANY_RE =
  /\b(firma|unternehmen|sponsor|sponsoren|gmbh|ag\b|startup|ansprechpartner|impressum|branche|firmensitz|unternehmensbeschreibung)\b/i;

const DEEP_RE = /\b(analysiere|analyse|recherchiere|tief|umfassend|die besten\s+\d+|liste|potenzielle)\b/i;

function languageOf(text: string): string {
  return /[äöüß]|und |für |nicht |suche /i.test(text) ? "de" : "en";
}

export function knowledgeKindOf(text: string): KnowledgeKind {
  if (REALTIME_RE.test(text)) return "realtime";
  if (CURRENT_RE.test(text)) return "current";
  return "stable";
}

export function freshnessOf(kind: KnowledgeKind): SearchFreshness {
  if (kind === "realtime") return "day";
  if (kind === "current") return "week";
  return "any";
}

export function detectResearchIntent(userRequest: string): ResearchIntent {
  const text = userRequest.trim();
  const knowledgeKind = knowledgeKindOf(text);
  const companyFocus = COMPANY_RE.test(text);
  const deep = DEEP_RE.test(text) || /\b\d{2,}\b/.test(text);
  let kind: ResearchIntentKind = "fact";
  if (companyFocus) kind = "company";
  else if (knowledgeKind === "realtime" || /\bnews|nachricht/i.test(text)) kind = "news";
  if (deep) kind = companyFocus ? "company" : "deep";
  const language = languageOf(text);
  return {
    kind,
    knowledgeKind,
    language,
    country: language === "de" ? "DE" : "US",
    freshness: freshnessOf(knowledgeKind),
    deep,
    companyFocus,
    statusMessage: "Ich recherchiere aktuelle Quellen.",
  };
}

export function needsLiveResearch(userRequest: string): boolean {
  const text = userRequest.trim();
  if (!text) return false;
  if (CURRENT_RE.test(text) || REALTIME_RE.test(text) || COMPANY_RE.test(text) || DEEP_RE.test(text)) return true;
  return /\b(web|internet|quelle|quellen|recherch)\b/i.test(text);
}

export function defaultSearchQueries(userRequest: string, intent: ResearchIntent): string[] {
  const base = userRequest.replace(/\s+/g, " ").trim().slice(0, 200);
  const queries = [base];
  if (intent.knowledgeKind !== "stable") {
    queries.push(`${base} ${intent.language === "de" ? "aktuell" : "latest"}`);
  }
  if (intent.companyFocus) {
    queries.push(`${base} offizielle Website`);
    queries.push(`${base} Impressum Kontakt`);
  }
  if (intent.kind === "news") {
    queries.push(`${base} ${new Date().getFullYear()}`);
  }
  return Array.from(new Set(queries)).slice(0, intent.deep ? 6 : 3);
}
