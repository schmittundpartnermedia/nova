import type { NovaAgent } from "@/types/agents";
import { detectKnowledgeIntent } from "@/agents/knowledge/intent";
import {
  buildKnowledgeContext,
  importKnowledgePaths,
  preparedChatGPTKnowledgeImport,
  requestKnowledgeCancel,
  searchKnowledge,
} from "@/services/knowledge";
import { assertOrganizationId } from "@/services/tenant";

export type KnowledgeAgentResult = {
  ok: boolean;
  summary: string;
  reply: string;
  statusMessage: string;
  importId?: string;
  cancelled?: boolean;
};

export const knowledgeAgent: NovaAgent = {
  definition: {
    id: "knowledge",
    name: "Knowledge Agent",
    description:
      "Dokumente und Ordner verstehen, strukturieren, Knowledge Items erzeugen, Quellen erhalten und Wissen wiederfinden. Nicht der Memory Service.",
    capabilities: [
      "knowledge-ingest",
      "document-parse",
      "pdf",
      "docx",
      "xlsx",
      "folder-import",
      "entity-extraction",
      "knowledge-search",
      "source-traceability",
    ],
    requiredTools: ["filesystem"],
    inputSchema: { path: "string?", paths: "string[]?", query: "string?", action: "import|search" },
    outputSchema: { summary: "string", itemsCreated: "number", hits: "KnowledgeHit[]" },
    riskLevel: "medium",
    implemented: true,
  },
  async run(input, context) {
    const result = await runKnowledgeAgent({
      organizationId: context.organizationId,
      jobId: context.jobId,
      userRequest: String(input.userRequest ?? context.userRequest),
      paths: Array.isArray(input.paths) ? (input.paths as string[]) : typeof input.path === "string" ? [input.path] : undefined,
      query: typeof input.query === "string" ? input.query : undefined,
      projectId: context.projectId,
    });
    return {
      ok: result.ok,
      summary: result.summary,
      data: {
        reply: result.reply,
        importId: result.importId ?? null,
        cancelled: Boolean(result.cancelled),
      },
    };
  },
};

export async function runKnowledgeAgent(input: {
  organizationId: string;
  jobId?: string;
  userRequest: string;
  paths?: string[];
  query?: string;
  projectId?: string;
  onStatus?: (message: string) => void;
}): Promise<KnowledgeAgentResult> {
  assertOrganizationId(input.organizationId);
  const intent = detectKnowledgeIntent(input.userRequest);
  input.onStatus?.(intent.statusMessage || "Knowledge Agent arbeitet.");

  if (intent.kind === "cancel") {
    const count = await requestKnowledgeCancel(input.organizationId);
    return {
      ok: true,
      cancelled: true,
      summary: `${count} Knowledge-Import(s) abgebrochen.`,
      reply: "Ich habe den Knowledge-Import gestoppt. Bereits sauber importierte Einträge bleiben erhalten.",
      statusMessage: "Abgebrochen",
    };
  }

  const paths = input.paths?.length ? input.paths : intent.paths;
  if (intent.kind === "query" || (input.query && !paths.length)) {
    const query = input.query ?? input.userRequest;
    const context = await buildKnowledgeContext({
      organizationId: input.organizationId,
      query,
      projectId: input.projectId,
    });
    return {
      ok: true,
      summary: context.hits.length ? `${context.hits.length} Wissens-Treffer` : "Kein Knowledge-Treffer",
      reply: context.answer,
      statusMessage: "Unterlagen geprüft",
    };
  }
  if (!paths.length) {
    return {
      ok: false,
      summary: "Kein zulässiger Pfad angegeben.",
      reply: "Bitte gib mir die Datei oder den Ordner, den ich lesen soll.",
      statusMessage: "Pfad fehlt",
    };
  }

  const imported = await importKnowledgePaths({
    organizationId: input.organizationId,
    userRequest: input.userRequest,
    paths,
    jobId: input.jobId,
    projectId: input.projectId,
  });
  return {
    ok: imported.ok,
    cancelled: imported.cancelled,
    importId: imported.importId,
    summary: imported.summary,
    reply: imported.reply,
    statusMessage: imported.cancelled ? "Abgebrochen" : "Unterlagen verarbeitet",
  };
}

export async function searchOrganizationKnowledge(organizationId: string, query: string, projectId?: string) {
  return searchKnowledge({ organizationId, query, projectId });
}

export async function chatgptKnowledgeStatus() {
  return preparedChatGPTKnowledgeImport();
}
