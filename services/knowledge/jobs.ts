import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { KnowledgeImportStatus } from "@/types/knowledge";

export async function createKnowledgeImport(input: {
  organizationId: string;
  userRequest: string;
  jobId?: string;
  rootPath?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.knowledgeImport.create({
    data: {
      organizationId: input.organizationId,
      userRequest: input.userRequest,
      jobId: input.jobId,
      rootPath: input.rootPath,
      kind: input.kind ?? "document",
      status: input.kind === "chatgpt" ? "VALIDATING" : "DISCOVERING",
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  });
}

export async function updateKnowledgeImport(input: {
  organizationId: string;
  id: string;
  status?: KnowledgeImportStatus;
  filesTotal?: number;
  filesSuccess?: number;
  filesSkipped?: number;
  filesFailed?: number;
  itemsCreated?: number;
  memoryUpdates?: number;
  relevantFiles?: number;
  progress?: Record<string, unknown>;
  error?: string;
  finished?: boolean;
  kind?: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.knowledgeImport.updateMany({
    where: { id: input.id, organizationId: input.organizationId },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.filesTotal != null ? { filesTotal: input.filesTotal } : {}),
      ...(input.filesSuccess != null ? { filesSuccess: input.filesSuccess } : {}),
      ...(input.filesSkipped != null ? { filesSkipped: input.filesSkipped } : {}),
      ...(input.filesFailed != null ? { filesFailed: input.filesFailed } : {}),
      ...(input.itemsCreated != null ? { itemsCreated: input.itemsCreated } : {}),
      ...(input.memoryUpdates != null ? { memoryUpdates: input.memoryUpdates } : {}),
      ...(input.relevantFiles != null ? { relevantFiles: input.relevantFiles } : {}),
      ...(input.progress ? { progressJson: JSON.stringify(input.progress) } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.tokensPrompt != null ? { tokensPrompt: input.tokensPrompt } : {}),
      ...(input.tokensCompletion != null ? { tokensCompletion: input.tokensCompletion } : {}),
      ...(input.finished ? { finishedAt: new Date() } : {}),
    },
  });
}

export async function requestKnowledgeCancel(organizationId: string): Promise<number> {
  assertOrganizationId(organizationId);
  const result = await prisma.knowledgeImport.updateMany({
    where: {
      organizationId,
      status: {
        in: [
          "VALIDATING",
          "EXTRACTING_ARCHIVE",
          "DISCOVERING",
          "PARSING",
          "PARSING_CONVERSATIONS",
          "IMPORTING_ARCHIVE",
          "EXTRACTING",
          "PROCESSING_KNOWLEDGE",
          "STRUCTURING",
          "RESOLVING_ENTITIES",
          "BUILDING_RELATIONS",
          "UPDATING_MEMORY",
          "INDEXING",
          "PREPARING",
          "EMBEDDING",
          "MEMORY_PROCESSING",
          "VERIFYING",
        ],
      },
    },
    data: { cancelRequested: true },
  });
  return result.count;
}

export async function knowledgeCancelRequested(organizationId: string, importId: string): Promise<boolean> {
  assertOrganizationId(organizationId);
  const row = await prisma.knowledgeImport.findFirst({
    where: { id: importId, organizationId },
    select: { cancelRequested: true },
  });
  return Boolean(row?.cancelRequested);
}

export async function getKnowledgeImport(organizationId: string, id: string) {
  assertOrganizationId(organizationId);
  return prisma.knowledgeImport.findFirst({
    where: { id, organizationId },
  });
}

export async function getLatestKnowledgeImport(organizationId: string, kind?: string) {
  assertOrganizationId(organizationId);
  return prisma.knowledgeImport.findFirst({
    where: { organizationId, ...(kind ? { kind } : {}) },
    orderBy: { startedAt: "desc" },
  });
}
