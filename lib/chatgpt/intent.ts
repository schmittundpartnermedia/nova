import { extractKnowledgePaths } from "@/agents/knowledge/intent";

export type ChatGPTIntentKind = "import" | "prompt" | "none";

export type ChatGPTImportIntent = {
  kind: ChatGPTIntentKind;
  userCommissioned: boolean;
  statusMessage: string;
  paths: string[];
};

const IMPORT_RE =
  /\b(?:chatgpt|chat\s*gpt)\b.{0,80}\b(?:importier(?:e|en)?|verlauf|export|zip|übernehm(?:e|en)?)\b/i;
const IMPORT_ALT_RE =
  /\b(?:importier(?:e|en)?|übernehm(?:e|en)?|nimm\s+auf)\b.{0,80}\b(?:chatgpt|chat\s*gpt|chatgpt-verlauf|chatgpt\s+export)\b/i;

export function detectChatGPTImportIntent(userRequest: string): ChatGPTImportIntent {
  const text = userRequest.trim();
  if (!text) return { kind: "none", userCommissioned: false, statusMessage: "", paths: [] };
  if (!IMPORT_RE.test(text) && !IMPORT_ALT_RE.test(text)) {
    return { kind: "none", userCommissioned: false, statusMessage: "", paths: [] };
  }
  const paths = extractKnowledgePaths(text);
  if (paths.length) {
    return {
      kind: "import",
      userCommissioned: true,
      statusMessage: "Ich importiere deinen ChatGPT-Verlauf.",
      paths,
    };
  }
  return {
    kind: "prompt",
    userCommissioned: true,
    statusMessage: "Wähle deinen ChatGPT-Export aus.",
    paths: [],
  };
}

export function isChatGPTImportRequest(userRequest: string): boolean {
  return detectChatGPTImportIntent(userRequest).kind !== "none";
}
