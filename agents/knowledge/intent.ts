import { namedVolumePaths } from "@/lib/computer/volumes";

export type KnowledgeIntentKind = "import" | "query" | "cancel" | "none";

export type KnowledgeIntent = {
  kind: KnowledgeIntentKind;
  userCommissioned: boolean;
  statusMessage: string;
  paths: string[];
};

const STOP_RE = /^(nova[,.\s]*)?(stopp?|stop|abbrechen|hör\s*auf|hoer\s*auf)\.?$/i;

const IMPORT_RE =
  /\b(?:lern(?:e|en)?|lies|lese|importier(?:e|en)?|analysier(?:e|en)?|nimm\s+auf|merk(?:e)?\s+dir)\b.{0,80}\b(?:pdf|docx|xlsx|csv|json|markdown|dokument(?:e|en)?|unterlagen|ordner|präsentation|export|datei(?:en)?|projekt)\b/i;

const IMPORT_ALT_RE =
  /\b(?:pdf|dokument(?:e|en)?|unterlagen|ordner|präsentation|export|dateien)\b.{0,40}\b(?:lern(?:e|en)?|lies|lese|importier(?:e|en)?|analysier(?:e|en)?|merk(?:e)?\s+dir)\b/i;

const QUERY_RE =
  /\b(?:was stand|was steht (?:in|im|auf|dazu|unter|beim)|welche entscheidung|suche in (?:allen )?unterlagen|in den unterlagen|aus dem angebot|aus dem vertrag|aus der pdf|aus der notiz|abnahme[- ]?notiz|wissens(?:eintrag|bank)|hast du gelesen|alte[rnms]?\s+preis(?:e|es)?|aktuell(?:e|en|er|es)?\s+preis(?:e|es)?|testpreis|warum wurde|wer gehört|welche[rnms]?\s+deadline|in welchem gespräch|was wurde später|chatgpt[- ]?(?:verlauf|gespräche)?)\b/i;

const PATH_RE = /(?:`([^`]+)`|"([^"]+)"|'([^']+)'|((?:~\/|\/)[^\s,;]+))/g;

export function extractKnowledgePaths(text: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((match = PATH_RE.exec(text))) {
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (value.startsWith("/") || value.startsWith("~/") || value.startsWith("./")) paths.push(value);
  }
  for (const volume of namedVolumePaths(text)) {
    if (!paths.includes(volume)) paths.push(volume);
  }
  return paths;
}

export function detectKnowledgeIntent(userRequest: string): KnowledgeIntent {
  const text = userRequest.trim();
  if (!text) return { kind: "none", userCommissioned: false, statusMessage: "", paths: [] };
  if (STOP_RE.test(text)) {
    return { kind: "cancel", userCommissioned: true, statusMessage: "Ich breche ab.", paths: [] };
  }
  const paths = extractKnowledgePaths(text);
  if (IMPORT_RE.test(text) || IMPORT_ALT_RE.test(text) || (namedVolumePaths(text).length > 0 && /\b(importier|lern(?:e|en)?|nimm\s+auf)\b/i.test(text))) {
    return {
      kind: "import",
      userCommissioned: true,
      statusMessage: "Ich lese die Unterlagen.",
      paths,
    };
  }
  if (QUERY_RE.test(text)) {
    return {
      kind: "query",
      userCommissioned: true,
      statusMessage: "Ich suche in den Unterlagen.",
      paths,
    };
  }
  return { kind: "none", userCommissioned: false, statusMessage: "", paths };
}

export function isKnowledgeRequest(userRequest: string): boolean {
  return detectKnowledgeIntent(userRequest).kind !== "none";
}
