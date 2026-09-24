import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { createJob, updateJobStatus } from "@/services/jobs";
import { ingestKnowledgeBuffer } from "@/services/knowledge";
import { importChatGPTExport } from "@/services/import/chatgpt";
import {
  createKnowledgeImport,
  getKnowledgeImport,
  getLatestKnowledgeImport,
  updateKnowledgeImport,
} from "@/services/knowledge/jobs";
import { recordActivity } from "@/services/archive";
import { isChatGPTExportZip } from "@/lib/chatgpt/adapter";
import { persistKnowledgeUpload } from "@/lib/knowledge/storage";
import { checksumBytes, detectSourceType, KNOWLEDGE_LIMITS } from "@/lib/knowledge/security";
import { formatImportSummary } from "@/lib/knowledge/ranking";
import {
  chatgptImportConversations,
  chatgptImportPercent,
  friendlyChatGPTImportError,
  isChatGPTImportTerminal,
} from "@/lib/chatgpt/progress";
import type { ChatGPTImportCheckpoint } from "@/types/chatgpt";

export type UploadFileInput = {
  name: string;
  mimeType?: string;
  bytes: Buffer;
};

export type UploadImportStatus = {
  ok: boolean;
  running: boolean;
  finished: boolean;
  kind: "upload" | "chatgpt";
  jobId?: string;
  importId: string;
  status: string;
  percent: number;
  error?: string | null;
  filesTotal: number;
  filesSuccess: number;
  filesSkipped: number;
  items: number;
  conversations: number;
  messages: number;
  decisions: number;
  entities: number;
  contradictions: number;
  summary?: string;
};

type UploadCheckpoint = {
  phase: string;
  filesTotal: number;
  filesSuccess: number;
  filesSkipped: number;
  filesFailed: number;
  itemsCreated: number;
  conversations: number;
  messages: number;
  decisions: number;
  entities: number;
  contradictions: number;
  summary?: string;
};

function emptyCheckpoint(total = 0): UploadCheckpoint {
  return {
    phase: "DISCOVERING",
    filesTotal: total,
    filesSuccess: 0,
    filesSkipped: 0,
    filesFailed: 0,
    itemsCreated: 0,
    conversations: 0,
    messages: 0,
    decisions: 0,
    entities: 0,
    contradictions: 0,
  };
}

function parseUploadCheckpoint(raw?: string | null): UploadCheckpoint {
  if (!raw) return emptyCheckpoint();
  try {
    return { ...emptyCheckpoint(), ...(JSON.parse(raw) as UploadCheckpoint) };
  } catch {
    return emptyCheckpoint();
  }
}

function isChatGPTZipFile(file: UploadFileInput): boolean {
  return /\.zip$/i.test(file.name) && isChatGPTExportZip(file.bytes);
}

export async function importUploadedFiles(input: {
  organizationId: string;
  userRequest?: string;
  jobId?: string;
  importId?: string;
  files: UploadFileInput[];
}): Promise<{ ok: boolean; importId: string; jobId?: string; summary: string }> {
  assertOrganizationId(input.organizationId);
  if (!input.files.length) throw new Error("Bitte eine Datei wählen.");
  const userRequest = input.userRequest ?? "Dateien hochladen";
  const onlyChatGPT = input.files.length === 1 && isChatGPTZipFile(input.files[0]!);
  const knowledgeImport =
    (input.importId
      ? await prisma.knowledgeImport.findFirst({
          where: { id: input.importId, organizationId: input.organizationId },
        })
      : null) ??
    (await createKnowledgeImport({
      organizationId: input.organizationId,
      userRequest,
      jobId: input.jobId,
      kind: onlyChatGPT ? "chatgpt" : "upload",
      metadata: { files: input.files.map((file) => file.name) },
    }));

  const checkpoint = emptyCheckpoint(input.files.length);
  const storedFirst = persistKnowledgeUpload({
    importId: knowledgeImport.id,
    filename: input.files[0]!.name,
    bytes: input.files[0]!.bytes,
  });
  if (onlyChatGPT) {
    const imported = await importChatGPTExport({
      organizationId: input.organizationId,
      userRequest,
      jobId: input.jobId,
      filePath: storedFirst,
      resumeImportId: knowledgeImport.id,
    });
    return { ok: imported.ok, importId: knowledgeImport.id, jobId: input.jobId, summary: imported.summary };
  }

  await updateKnowledgeImport({
    organizationId: input.organizationId,
    id: knowledgeImport.id,
    status: "DISCOVERING",
    filesTotal: input.files.length,
    progress: checkpoint,
  });

  for (const [index, file] of input.files.entries()) {
    const storedPath =
      index === 0
        ? storedFirst
        : persistKnowledgeUpload({
            importId: knowledgeImport.id,
            filename: file.name,
            bytes: file.bytes,
          });
    try {
      if (isChatGPTZipFile(file)) {
        await updateKnowledgeImport({
          organizationId: input.organizationId,
          id: knowledgeImport.id,
          status: "IMPORTING_ARCHIVE",
          progress: { ...checkpoint, phase: "IMPORTING_ARCHIVE" },
        });
        const imported = await importChatGPTExport({
          organizationId: input.organizationId,
          userRequest,
          jobId: input.jobId,
          filePath: storedPath,
        });
        checkpoint.conversations += imported.conversationsImported + imported.conversationsSkipped;
        checkpoint.messages += imported.messagesImported;
        checkpoint.decisions += imported.decisions;
        checkpoint.entities += imported.entities;
        checkpoint.contradictions += imported.contradictions;
        checkpoint.itemsCreated += imported.itemsCreated;
        if (imported.ok) checkpoint.filesSuccess += 1;
        else checkpoint.filesFailed += 1;
      } else {
        const sourceType = detectSourceType(file.name, file.mimeType);
        const catalogOnly = file.bytes.length > KNOWLEDGE_LIMITS.maxFileBytes;
        const catalogBytes = catalogOnly
          ? Buffer.from(`${file.name}\n${file.mimeType ?? sourceType}\n${storedPath}`, "utf8")
          : file.bytes;
        await updateKnowledgeImport({
          organizationId: input.organizationId,
          id: knowledgeImport.id,
          status: "PROCESSING_KNOWLEDGE",
          progress: { ...checkpoint, phase: "PROCESSING_KNOWLEDGE" },
        });
        const ingested = await ingestKnowledgeBuffer({
          organizationId: input.organizationId,
          importId: knowledgeImport.id,
          jobId: input.jobId,
          name: file.name,
          originalPath: storedPath,
          bytes: catalogBytes,
          mimeType: file.mimeType,
          sourceType,
          checksum: checksumBytes(file.bytes),
          size: file.bytes.length,
          catalogOnly,
        });
        if (ingested.duplicate) checkpoint.filesSkipped += 1;
        else if (ingested.skipped) checkpoint.filesFailed += 1;
        else {
          checkpoint.filesSuccess += 1;
          checkpoint.itemsCreated += ingested.items;
        }
      }
    } catch (error) {
      checkpoint.filesFailed += 1;
      await updateKnowledgeImport({
        organizationId: input.organizationId,
        id: knowledgeImport.id,
        error: error instanceof Error ? error.message : "Datei fehlgeschlagen",
        progress: checkpoint,
      });
    }
    await updateKnowledgeImport({
      organizationId: input.organizationId,
      id: knowledgeImport.id,
      filesTotal: checkpoint.filesTotal,
      filesSuccess: checkpoint.filesSuccess,
      filesSkipped: checkpoint.filesSkipped,
      filesFailed: checkpoint.filesFailed,
      itemsCreated: checkpoint.itemsCreated,
      progress: checkpoint,
    });
  }

  const status =
    checkpoint.filesFailed && !checkpoint.filesSuccess
      ? "FAILED"
      : checkpoint.filesFailed
        ? "PARTIAL"
        : "COMPLETED";
  const summary = onlyChatGPT
    ? `ChatGPT-Verlauf importiert. ${checkpoint.conversations} Gespräche, ${checkpoint.messages} Nachrichten, ${checkpoint.itemsCreated} Wissenseinträge.`
    : formatImportSummary({
        filesTotal: checkpoint.filesTotal,
        relevantFiles: checkpoint.filesSuccess,
        itemsCreated: checkpoint.itemsCreated,
        filesFailed: checkpoint.filesFailed,
        filesSkipped: checkpoint.filesSkipped,
        duplicates: checkpoint.filesSkipped,
      });
  checkpoint.phase = status;
  checkpoint.summary = summary;
  await updateKnowledgeImport({
    organizationId: input.organizationId,
    id: knowledgeImport.id,
    status,
    filesTotal: checkpoint.filesTotal,
    filesSuccess: checkpoint.filesSuccess,
    filesSkipped: checkpoint.filesSkipped,
    filesFailed: checkpoint.filesFailed,
    itemsCreated: checkpoint.itemsCreated,
    progress: checkpoint,
    finished: true,
    error: status === "FAILED" ? "Mindestens eine Datei konnte nicht übernommen werden." : undefined,
  });
  await recordActivity({
    organizationId: input.organizationId,
    type: "knowledge",
    title: onlyChatGPT ? "ChatGPT Import" : "Dateien übernommen",
    description: summary,
    status: "prepared",
    jobId: input.jobId,
    metadata: { importId: knowledgeImport.id, checkpoint },
  });
  return { ok: status !== "FAILED", importId: knowledgeImport.id, jobId: input.jobId, summary };
}

export async function getUploadImportStatus(
  organizationId: string,
  query?: { jobId?: string; importId?: string },
): Promise<UploadImportStatus | null> {
  assertOrganizationId(organizationId);
  const row = query?.importId
    ? await getKnowledgeImport(organizationId, query.importId)
    : query?.jobId
      ? await prisma.knowledgeImport.findFirst({
          where: { organizationId, jobId: query.jobId },
          orderBy: { startedAt: "desc" },
        })
      : await getLatestKnowledgeImport(organizationId);
  if (!row) return null;
  const kind = row.kind === "chatgpt" ? "chatgpt" : "upload";
  if (kind === "chatgpt") {
    const checkpoint = (() => {
      try {
        return JSON.parse(row.progressJson ?? "{}") as ChatGPTImportCheckpoint;
      } catch {
        return null;
      }
    })();
    const running = !isChatGPTImportTerminal(row.status);
    const failed = row.status === "FAILED" || row.status === "CANCELLED";
    return {
      ok: !failed,
      running,
      finished: !running,
      kind,
      jobId: row.jobId ?? undefined,
      importId: row.id,
      status: row.status,
      percent: checkpoint ? chatgptImportPercent(checkpoint) : running ? 5 : 100,
      error: failed ? friendlyChatGPTImportError(row.error) : null,
      filesTotal: row.filesTotal,
      filesSuccess: row.filesSuccess,
      filesSkipped: row.filesSkipped,
      items: checkpoint?.itemsCreated ?? row.itemsCreated,
      conversations: checkpoint ? chatgptImportConversations(checkpoint) : 0,
      messages: checkpoint?.messagesImported ?? 0,
      decisions: checkpoint?.decisions ?? 0,
      entities: checkpoint?.entities ?? 0,
      contradictions: checkpoint?.contradictions ?? 0,
      summary: checkpoint?.summary,
    };
  }
  const checkpoint = parseUploadCheckpoint(row.progressJson);
  const running = !["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(row.status);
  const failed = row.status === "FAILED" || row.status === "CANCELLED";
  const done = checkpoint.filesSuccess + checkpoint.filesSkipped + checkpoint.filesFailed;
  const percent = running
    ? checkpoint.filesTotal
      ? Math.min(99, Math.round((done / checkpoint.filesTotal) * 100) || 5)
      : 5
    : 100;
  return {
    ok: !failed,
    running,
    finished: !running,
    kind,
    jobId: row.jobId ?? undefined,
    importId: row.id,
    status: row.status,
    percent,
    error: failed ? row.error || "Der Import ist fehlgeschlagen. Du kannst es erneut versuchen." : null,
    filesTotal: checkpoint.filesTotal || row.filesTotal,
    filesSuccess: checkpoint.filesSuccess || row.filesSuccess,
    filesSkipped: checkpoint.filesSkipped || row.filesSkipped,
    items: checkpoint.itemsCreated || row.itemsCreated,
    conversations: checkpoint.conversations,
    messages: checkpoint.messages,
    decisions: checkpoint.decisions,
    entities: checkpoint.entities,
    contradictions: checkpoint.contradictions,
    summary: checkpoint.summary,
  };
}

export async function startUploadJob(input: {
  organizationId: string;
  files: UploadFileInput[];
}) {
  const job = await createJob({
    organizationId: input.organizationId,
    userRequest: "Dateien hochladen",
    goal: "Dateien übernehmen und zuordnen",
  });
  await updateJobStatus(input.organizationId, job.id, "running", { startedAt: new Date() });
  const knowledgeImport = await createKnowledgeImport({
    organizationId: input.organizationId,
    userRequest: "Dateien hochladen",
    jobId: job.id,
    kind: input.files.length === 1 && isChatGPTZipFile(input.files[0]!) ? "chatgpt" : "upload",
    metadata: { files: input.files.map((file) => file.name) },
  });
  return { job, importId: knowledgeImport.id };
}
