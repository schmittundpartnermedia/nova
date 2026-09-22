import type { ChatGPTImportCheckpoint, ChatGPTImportPhase } from "@/types/chatgpt";

const TERMINAL: ChatGPTImportPhase[] = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];

export type ChatGPTImportStatusView = {
  ok: boolean;
  running: boolean;
  finished: boolean;
  jobId?: string;
  importId: string;
  status: string;
  percent: number;
  error?: string | null;
  conversations: number;
  messages: number;
  items: number;
  decisions: number;
  entities: number;
  contradictions: number;
  summary?: string;
};

export function isChatGPTImportTerminal(status: string): boolean {
  return TERMINAL.includes(status as ChatGPTImportPhase);
}

export function chatgptImportPercent(checkpoint: Pick<ChatGPTImportCheckpoint, "phase" | "conversationsTotal" | "processedExternalIds" | "conversationsSkipped">): number {
  const phase = checkpoint.phase;
  if (phase === "COMPLETED" || phase === "PARTIAL") return 100;
  if (phase === "FAILED" || phase === "CANCELLED") {
    const total = checkpoint.conversationsTotal;
    if (!total) return 0;
    const done = checkpoint.processedExternalIds.length + checkpoint.conversationsSkipped;
    return Math.min(99, Math.round((done / total) * 90));
  }
  const phaseFloor: Record<string, number> = {
    VALIDATING: 2,
    EXTRACTING_ARCHIVE: 6,
    DISCOVERING: 10,
    PARSING_CONVERSATIONS: 14,
    IMPORTING_ARCHIVE: 18,
    PROCESSING_KNOWLEDGE: 18,
    RESOLVING_ENTITIES: 92,
    BUILDING_RELATIONS: 94,
    UPDATING_MEMORY: 96,
    INDEXING: 98,
    VERIFYING: 99,
  };
  if (phase === "IMPORTING_ARCHIVE" || phase === "PROCESSING_KNOWLEDGE") {
    const total = checkpoint.conversationsTotal;
    if (!total) return 18;
    const done = checkpoint.processedExternalIds.length + checkpoint.conversationsSkipped;
    return Math.min(90, 15 + Math.round((done / total) * 75));
  }
  return phaseFloor[phase] ?? 1;
}

export function friendlyChatGPTImportError(message?: string | null): string {
  const text = (message ?? "").trim();
  if (!text) return "Der Import ist fehlgeschlagen. Du kannst es erneut versuchen.";
  if (/kein gültiges zip|kein chatgpt-export gefunden|conversations\.json fehlt|in der zip fehlt conversations|kein gültiges json|zip enthält keine conversations/i.test(text)) {
    return "Das ist kein gültiger ChatGPT-Export. Bitte die originale ZIP-Datei wählen, die du von OpenAI heruntergeladen hast.";
  }
  if (/überschreitet das Import-Limit/i.test(text)) {
    return "Die Datei ist zu groß für den Import.";
  }
  if (/nicht unterstützte zip-kompression/i.test(text)) {
    return "Diese ZIP-Datei kann ich nicht lesen. Bitte den originalen ChatGPT-Export verwenden, ohne ihn vorher zu entpacken oder neu zu packen.";
  }
  return text;
}

export function chatgptImportConversations(checkpoint: ChatGPTImportCheckpoint): number {
  return checkpoint.conversationsImported + checkpoint.conversationsSkipped;
}
