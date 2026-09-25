import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { createJob, updateJobStatus } from "@/services/jobs";
import { createKnowledgeImport, knowledgeCancelRequested, updateKnowledgeImport } from "@/services/knowledge/jobs";
import { reindexExistingKnowledge } from "@/services/retrieval/discover";
import type { EmbeddingProvider } from "@/providers/embedding";

const ACTIVE = ["DISCOVERING", "PREPARING", "EMBEDDING", "INDEXING", "VERIFYING"];

export async function startRetrievalReindex(input: { organizationId: string; provider?: EmbeddingProvider }) {
  assertOrganizationId(input.organizationId);
  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: "reindex existing knowledge",
    goal: "Retrieval-V2-Index aufbauen",
  });
  const record = await createKnowledgeImport({
    organizationId: input.organizationId,
    userRequest: "reindex existing knowledge",
    jobId: job.id,
    kind: "retrieval-reindex",
  });
  void updateJobStatus(input.organizationId, job.id, "running", { startedAt: new Date() });
  void runRetrievalReindex({ organizationId: input.organizationId, importId: record.id, jobId: job.id, provider: input.provider });
  return { jobId: job.id, importId: record.id };
}

export async function runRetrievalReindex(input: {
  organizationId: string;
  importId: string;
  jobId?: string;
  provider?: EmbeddingProvider;
}) {
  assertOrganizationId(input.organizationId);
  const result = await reindexExistingKnowledge({
    organizationId: input.organizationId,
    provider: input.provider,
    shouldCancel: () => knowledgeCancelRequested(input.organizationId, input.importId),
    onPhase: async (phase, stats) => {
      const progress = stats.processed + stats.failed + stats.skipped;
      await updateKnowledgeImport({
        organizationId: input.organizationId,
        id: input.importId,
        status: phase === "COMPLETED" ? "COMPLETED" : (phase as "DISCOVERING"),
        filesTotal: progress,
        filesSuccess: stats.processed,
        filesFailed: stats.failed,
        filesSkipped: stats.skipped + stats.cached,
        progress: { phase, ...stats, progress },
        finished: phase === "COMPLETED",
      });
    },
  });
  if (result.cancelled) {
    await updateKnowledgeImport({
      organizationId: input.organizationId,
      id: input.importId,
      status: "CANCELLED",
      filesSuccess: result.processed,
      filesFailed: result.failed,
      filesSkipped: result.skipped,
      finished: true,
      progress: { phase: "CANCELLED", ...result },
    });
    if (input.jobId) await updateJobStatus(input.organizationId, input.jobId, "cancelled", { completedAt: new Date() });
    return result;
  }
  if (input.jobId) await updateJobStatus(input.organizationId, input.jobId, "completed", { completedAt: new Date() });
  return result;
}

export async function retrievalCancelRequested(organizationId: string): Promise<boolean> {
  assertOrganizationId(organizationId);
  const row = await prisma.knowledgeImport.findFirst({
    where: { organizationId, kind: "retrieval-reindex", status: { in: ACTIVE } },
    orderBy: { startedAt: "desc" },
    select: { cancelRequested: true },
  });
  return Boolean(row?.cancelRequested);
}
