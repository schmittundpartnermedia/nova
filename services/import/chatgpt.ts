import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { createSource } from "@/services/memory";
import { recordActivity } from "@/services/archive";
import { addJobStep, completeJobStep } from "@/services/jobs";
import { ingestKnowledgeBuffer, ingestParsedKnowledge } from "@/services/knowledge";
import { importArchivedMessage } from "@/services/conversation";
import { createKnowledgeImport, knowledgeCancelRequested, updateKnowledgeImport } from "@/services/knowledge/jobs";
import { inspectChatGPTExport, isImageAttachment, loadAttachmentBytes, parseChatGPTExport } from "@/lib/chatgpt/adapter";
import { conversationToParsedDocument, estimatedTokens, extractConversationKnowledge } from "@/lib/chatgpt/extract";
import { resolveExistingEntity } from "@/lib/knowledge/entities";
import { formatChatGPTImportSummary } from "@/lib/knowledge/ranking";
import type { ChatGPTImportCheckpoint, ChatGPTImportPhase, ChatGPTImportResult, ImportedConversation, ImportedMessage } from "@/types/chatgpt";
import type { ConversationRole } from "@/types/conversation";
import type { RelationType } from "@/types";

const ORIGIN = "chatgpt_import";

function conversationRole(role: ImportedMessage["role"]): ConversationRole {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "system";
}

function emptyCheckpoint(): ChatGPTImportCheckpoint {
  return {
    phase: "VALIDATING",
    processedExternalIds: [],
    failedExternalIds: [],
    conversationsTotal: 0,
    conversationsImported: 0,
    conversationsSkipped: 0,
    messagesImported: 0,
    attachmentsImported: 0,
    itemsCreated: 0,
    memoryUpdates: 0,
    decisions: 0,
    contradictions: 0,
    tokensPrompt: 0,
    tokensCompletion: 0,
  };
}

function parseCheckpoint(raw?: string | null): ChatGPTImportCheckpoint {
  if (!raw) return emptyCheckpoint();
  try {
    return { ...emptyCheckpoint(), ...(JSON.parse(raw) as ChatGPTImportCheckpoint) };
  } catch {
    return emptyCheckpoint();
  }
}

async function setPhase(input: {
  organizationId: string;
  importId: string;
  checkpoint: ChatGPTImportCheckpoint;
  phase: ChatGPTImportPhase;
}) {
  input.checkpoint.phase = input.phase;
  await updateKnowledgeImport({
    organizationId: input.organizationId,
    id: input.importId,
    status: input.phase,
    progress: input.checkpoint,
    tokensPrompt: input.checkpoint.tokensPrompt,
    tokensCompletion: input.checkpoint.tokensCompletion,
    itemsCreated: input.checkpoint.itemsCreated,
    memoryUpdates: input.checkpoint.memoryUpdates,
    filesTotal: input.checkpoint.conversationsTotal,
    filesSuccess: input.checkpoint.conversationsImported,
    filesSkipped: input.checkpoint.conversationsSkipped,
    filesFailed: input.checkpoint.failedExternalIds.length,
  });
}

export async function importChatGPTExport(input: {
  organizationId: string;
  userRequest?: string;
  jobId?: string;
  zipBytes?: Buffer;
  jsonBytes?: Buffer;
  filePath?: string;
  conversations?: unknown[];
  resumeImportId?: string;
}): Promise<ChatGPTImportResult> {
  assertOrganizationId(input.organizationId);
  const userRequest = input.userRequest ?? "Importiere ChatGPT-Verlauf";
  const existing = input.resumeImportId
    ? await prisma.knowledgeImport.findFirst({
        where: { id: input.resumeImportId, organizationId: input.organizationId, kind: "chatgpt" },
      })
    : null;
  const knowledgeImport =
    existing ??
    (await createKnowledgeImport({
      organizationId: input.organizationId,
      userRequest,
      jobId: input.jobId,
      rootPath: input.filePath,
      kind: "chatgpt",
      metadata: { source: "CHATGPT" },
    }));
  const checkpoint = parseCheckpoint(knowledgeImport.progressJson);
  const step = input.jobId
    ? await addJobStep({
        organizationId: input.organizationId,
        jobId: input.jobId,
        agent: "knowledge",
        action: "chatgpt-import",
        input: { path: input.filePath ?? "upload" },
      })
    : null;

  const source = await createSource({
    organizationId: input.organizationId,
    type: "chatgpt",
    label: "ChatGPT Export",
    reference: knowledgeImport.id,
    jobId: input.jobId,
    metadata: { importId: knowledgeImport.id },
  });

  let cancelled = false;
  const sourceIds: string[] = [];
  try {
    await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "VALIDATING" });
    if (await knowledgeCancelRequested(input.organizationId, knowledgeImport.id)) {
      cancelled = true;
    } else {
      await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "EXTRACTING_ARCHIVE" });
      const parsed = input.conversations
        ? parseChatGPTExport({ jsonBytes: Buffer.from(JSON.stringify(input.conversations), "utf8") })
        : parseChatGPTExport({ zipBytes: input.zipBytes, jsonBytes: input.jsonBytes, filePath: input.filePath });
      inspectChatGPTExport({ zipBytes: parsed.zipBytes, jsonBytes: input.jsonBytes, filePath: input.filePath });
      await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "DISCOVERING" });
      checkpoint.conversationsTotal = parsed.conversations.length;
      await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "PARSING_CONVERSATIONS" });

      const processed = new Set(checkpoint.processedExternalIds);
      for (const conversation of parsed.conversations) {
        if (await knowledgeCancelRequested(input.organizationId, knowledgeImport.id)) {
          cancelled = true;
          break;
        }
        if (processed.has(conversation.externalId) && conversation.checksum) {
          const stored = await prisma.conversation.findFirst({
            where: {
              organizationId: input.organizationId,
              origin: ORIGIN,
              externalId: conversation.externalId,
              checksum: conversation.checksum,
            },
          });
          if (stored) {
            checkpoint.conversationsSkipped += 1;
            continue;
          }
        }
        try {
          await setPhase({
            organizationId: input.organizationId,
            importId: knowledgeImport.id,
            checkpoint,
            phase: "IMPORTING_ARCHIVE",
          });
          const archived = await upsertImportedConversation({
            organizationId: input.organizationId,
            conversation,
            jobId: input.jobId,
          });
          if (archived.skipped) {
            checkpoint.conversationsSkipped += 1;
          } else {
            checkpoint.conversationsImported += 1;
            checkpoint.messagesImported += archived.messagesImported;
          }
          if (archived.changed) {
            await setPhase({
              organizationId: input.organizationId,
              importId: knowledgeImport.id,
              checkpoint,
              phase: "PROCESSING_KNOWLEDGE",
            });
            const knowledge = await processConversationKnowledge({
              organizationId: input.organizationId,
              importId: knowledgeImport.id,
              jobId: input.jobId,
              conversation,
              archiveConversationId: archived.id,
              messageIdByExternal: archived.messageIdByExternal,
              zipBytes: parsed.zipBytes,
            });
            checkpoint.itemsCreated += knowledge.itemsCreated;
            checkpoint.memoryUpdates += knowledge.memoryUpdates;
            checkpoint.decisions += knowledge.decisions;
            checkpoint.attachmentsImported += knowledge.attachmentsImported;
            checkpoint.tokensPrompt += knowledge.tokensPrompt;
            if (knowledge.sourceId) sourceIds.push(knowledge.sourceId);
          }
          processed.add(conversation.externalId);
          checkpoint.processedExternalIds = Array.from(processed);
        } catch (error) {
          checkpoint.failedExternalIds.push(conversation.externalId);
          checkpoint.processedExternalIds = Array.from(processed);
          await updateKnowledgeImport({
            organizationId: input.organizationId,
            id: knowledgeImport.id,
            error: error instanceof Error ? error.message : "Conversation fehlgeschlagen",
            progress: checkpoint,
          });
        }
      }

      if (!cancelled) {
        await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "RESOLVING_ENTITIES" });
        await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "BUILDING_RELATIONS" });
        await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "UPDATING_MEMORY" });
        await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "INDEXING" });
        checkpoint.contradictions = await prisma.knowledgeContradiction.count({
          where: { organizationId: input.organizationId },
        });
        await setPhase({ organizationId: input.organizationId, importId: knowledgeImport.id, checkpoint, phase: "VERIFYING" });
      }
    }
  } catch (error) {
    await updateKnowledgeImport({
      organizationId: input.organizationId,
      id: knowledgeImport.id,
      status: "FAILED",
      error: error instanceof Error ? error.message : "Import fehlgeschlagen",
      progress: checkpoint,
      finished: true,
    });
    if (step) {
      await completeJobStep({
        organizationId: input.organizationId,
        stepId: step.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Import fehlgeschlagen",
      });
    }
    throw error;
  }

  const entities = await prisma.knowledgeItem.count({
    where: {
      organizationId: input.organizationId,
      sourceId: { in: sourceIds },
      type: { in: ["PROJECT", "COMPANY", "PERSON"] },
    },
  });
  const status = cancelled
    ? "CANCELLED"
    : checkpoint.failedExternalIds.length && checkpoint.conversationsImported
      ? "PARTIAL"
      : checkpoint.failedExternalIds.length && !checkpoint.conversationsImported
        ? "FAILED"
        : "COMPLETED";
  await updateKnowledgeImport({
    organizationId: input.organizationId,
    id: knowledgeImport.id,
    status,
    itemsCreated: checkpoint.itemsCreated,
    memoryUpdates: checkpoint.memoryUpdates,
    filesTotal: checkpoint.conversationsTotal,
    filesSuccess: checkpoint.conversationsImported,
    filesSkipped: checkpoint.conversationsSkipped,
    filesFailed: checkpoint.failedExternalIds.length,
    tokensPrompt: checkpoint.tokensPrompt,
    tokensCompletion: checkpoint.tokensCompletion,
    progress: { ...checkpoint, phase: status },
    finished: true,
  });
  if (step) {
    await completeJobStep({
      organizationId: input.organizationId,
      stepId: step.id,
      status: cancelled ? "skipped" : status === "FAILED" ? "failed" : "completed",
      output: checkpoint,
    });
  }
  const summary = formatChatGPTImportSummary({
    conversations: checkpoint.conversationsImported + checkpoint.conversationsSkipped,
    messages: checkpoint.messagesImported,
    items: checkpoint.itemsCreated,
    decisions: checkpoint.decisions,
    entities,
    contradictions: checkpoint.contradictions,
  });
  await recordActivity({
    organizationId: input.organizationId,
    type: "knowledge",
    title: "ChatGPT Import",
    description: summary,
    status: "prepared",
    jobId: input.jobId,
    metadata: { importId: knowledgeImport.id, sourceId: source.id, checkpoint },
  });
  return {
    ok: !cancelled && status !== "FAILED",
    cancelled,
    resumed: Boolean(existing),
    incremental: checkpoint.conversationsSkipped > 0,
    importId: knowledgeImport.id,
    summary,
    reply: cancelled
      ? "Ich habe den ChatGPT-Import gestoppt. Bereits vollständig verarbeitete Gespräche bleiben erhalten."
      : `Import abgeschlossen. Ich habe deine bisherigen Gespräche übernommen und relevantes Wissen mit meinem Memory verbunden.\n\n${summary}`,
    conversationsTotal: checkpoint.conversationsTotal,
    conversationsImported: checkpoint.conversationsImported,
    conversationsSkipped: checkpoint.conversationsSkipped,
    messagesImported: checkpoint.messagesImported,
    itemsCreated: checkpoint.itemsCreated,
    memoryUpdates: checkpoint.memoryUpdates,
    decisions: checkpoint.decisions,
    entities,
    contradictions: checkpoint.contradictions,
    attachmentsImported: checkpoint.attachmentsImported,
    duplicates: checkpoint.conversationsSkipped,
    tokensPrompt: checkpoint.tokensPrompt,
    tokensCompletion: checkpoint.tokensCompletion,
    sourceIds,
  };
}

async function upsertImportedConversation(input: {
  organizationId: string;
  conversation: ImportedConversation;
  jobId?: string;
}): Promise<{
  id: string;
  skipped: boolean;
  changed: boolean;
  messagesImported: number;
  messageIdByExternal: Map<string, string>;
}> {
  const existing = await prisma.conversation.findFirst({
    where: {
      organizationId: input.organizationId,
      origin: ORIGIN,
      externalId: input.conversation.externalId,
    },
  });
  const importedAt = new Date();
  const metadata = JSON.stringify({
    source: "CHATGPT_IMPORT",
    externalId: input.conversation.externalId,
    checksum: input.conversation.checksum,
    currentNode: input.conversation.metadata.currentNode,
    alternativeBranches: input.conversation.alternativeBranches.length,
  });
  const row =
    existing ??
    (await prisma.conversation.create({
      data: {
        organizationId: input.organizationId,
        title: input.conversation.title,
        origin: ORIGIN,
        externalId: input.conversation.externalId,
        checksum: input.conversation.checksum,
        importedAt,
        startedAt: input.conversation.createdAt,
        lastActivityAt: input.conversation.updatedAt,
        createdAt: input.conversation.createdAt,
        status: "archived",
        jobId: input.jobId,
        metadata,
      },
    }));
  if (existing && existing.checksum === input.conversation.checksum) {
    const messageIdByExternal = new Map<string, string>();
    const messages = await prisma.conversationMessage.findMany({
      where: { organizationId: input.organizationId, conversationId: row.id },
      select: { id: true, externalId: true },
    });
    for (const message of messages) {
      if (message.externalId) messageIdByExternal.set(message.externalId, message.id);
    }
    return { id: row.id, skipped: true, changed: false, messagesImported: 0, messageIdByExternal };
  }
  if (existing) {
    const project = await resolveExistingEntity({
      organizationId: input.organizationId,
      name: input.conversation.title,
      kind: "project",
    });
    await prisma.conversation.update({
      where: { id: row.id },
      data: {
        title: input.conversation.title,
        checksum: input.conversation.checksum,
        importedAt,
        lastActivityAt: input.conversation.updatedAt,
        projectId: project?.kind === "project" ? project.id : existing.projectId,
        metadata,
      },
    });
  } else {
    const project = await resolveExistingEntity({
      organizationId: input.organizationId,
      name: input.conversation.title,
      kind: "project",
    });
    if (project?.kind === "project") {
      await prisma.conversation.update({
        where: { id: row.id },
        data: { projectId: project.id },
      });
    }
  }

  const allMessages = [
    ...input.conversation.primaryPath,
    ...input.conversation.alternativeBranches.flat(),
  ];
  const messageIdByExternal = new Map<string, string>();
  let messagesImported = 0;
  for (const message of allMessages) {
    const stored = await importArchivedMessage({
      organizationId: input.organizationId,
      conversationId: row.id,
      role: conversationRole(message.role),
      content: message.content || "[leer]",
      createdAt: message.createdAt,
      externalId: message.externalId,
      parentExternalId: message.parentExternalId,
      metadata: {
        source: "CHATGPT_IMPORT",
        branch: message.branch,
        isPrimary: message.isPrimary,
        model: message.model,
        attachments: message.attachments,
        codeBlocks: message.codeBlocks,
        links: message.links,
        injectionSuspected: message.injectionSuspected,
        secretRedacted: message.secretRedacted,
        untrustedHistoricalContent: true,
      },
    });
    messageIdByExternal.set(message.externalId, stored.id);
    if (stored.createdAt === message.createdAt.toISOString() || stored.id) {
      messagesImported += 1;
    }
  }
  return { id: row.id, skipped: false, changed: true, messagesImported, messageIdByExternal };
}

async function processConversationKnowledge(input: {
  organizationId: string;
  importId: string;
  jobId?: string;
  conversation: ImportedConversation;
  archiveConversationId: string;
  messageIdByExternal: Map<string, string>;
  zipBytes?: Buffer;
}): Promise<{
  sourceId?: string;
  itemsCreated: number;
  memoryUpdates: number;
  decisions: number;
  attachmentsImported: number;
  tokensPrompt: number;
}> {
  const drafts = extractConversationKnowledge(input.conversation);
  const parsed = conversationToParsedDocument(input.conversation);
  const projectGuess =
    drafts.find((item) => item.type === "PROJECT")?.entityName ?? input.conversation.title;
  const resolvedProject = await resolveExistingEntity({
    organizationId: input.organizationId,
    name: projectGuess,
    kind: "project",
  });
  const resolvedCompany = drafts.find((item) => item.type === "COMPANY")
    ? await resolveExistingEntity({
        organizationId: input.organizationId,
        name: drafts.find((item) => item.type === "COMPANY")!.entityName ?? drafts.find((item) => item.type === "COMPANY")!.title,
        kind: "company",
      })
    : null;

  const relevantText = drafts.map((item) => item.content).join("\n");
  const tokensPrompt = estimatedTokens(relevantText.slice(0, 20_000));

  const ingested = await ingestParsedKnowledge({
    organizationId: input.organizationId,
    importId: input.importId,
    jobId: input.jobId,
    projectId: resolvedProject?.kind === "project" ? resolvedProject.id : undefined,
    companyId: resolvedCompany?.kind === "company" ? resolvedCompany.id : undefined,
    name: input.conversation.title,
    originalPath: `chatgpt:${input.conversation.externalId}`,
    sourceType: "chatgpt",
    checksum: input.conversation.checksum,
    size: Buffer.byteLength(parsed.fulltext, "utf8"),
    parsed,
    conversationId: input.archiveConversationId,
    sourceTypeMemory: "chatgpt",
    items: drafts.map((draft) => ({
      type: draft.type,
      title: draft.title,
      content: draft.content,
      normalizedKey: draft.normalizedKey,
      normalizedValue: draft.normalizedValue,
      entityName: draft.entityName,
      excerpt: draft.excerpt,
      confidence: draft.confidence,
      location: {
        conversationId: input.archiveConversationId,
        conversationTitle: input.conversation.title,
        messageId: draft.messageExternalIds.map((id) => input.messageIdByExternal.get(id)).find(Boolean),
        messageExternalId: draft.messageExternalIds[0],
        occurredAt: draft.occurredAt?.toISOString(),
      },
      relations: draft.relations.filter((item) => ["works_at", "belongs_to", "relates_to", "product_of", "mentions", "has_deadline", "attached_to", "considered_as_partner_for", "used_by", "supersedes"].includes(item.type)) as Array<{
        from: string;
        type: RelationType;
        to: string;
      }>,
      epistemicStatus: draft.epistemicStatus,
      conversationMessageId: draft.messageExternalIds.map((id) => input.messageIdByExternal.get(id)).find(Boolean),
      occurredAt: draft.occurredAt,
    })),
  });

  let attachmentsImported = 0;
  const seenChecksum = new Set<string>();
  for (const message of input.conversation.primaryPath) {
    for (const attachment of message.attachments) {
      const bytes = loadAttachmentBytes(input.zipBytes, attachment);
      if (!bytes) {
        if (isImageAttachment(attachment)) attachmentsImported += 1;
        continue;
      }
      if (attachment.checksum && seenChecksum.has(attachment.checksum)) continue;
      if (attachment.checksum) seenChecksum.add(attachment.checksum);
      if (isImageAttachment(attachment)) {
        await prisma.knowledgeSource.create({
          data: {
            organizationId: input.organizationId,
            sourceType: "unknown",
            name: attachment.name,
            originalPath: attachment.zipPath,
            checksum: attachment.checksum ?? `image:${attachment.externalId}`,
            size: bytes.length,
            status: "INDEXED",
            importId: input.importId,
            conversationId: input.archiveConversationId,
            skippedReason: "image-metadata-only",
            metadata: JSON.stringify({
              attachedTo: input.messageIdByExternal.get(message.externalId),
              conversationTitle: input.conversation.title,
            }),
          },
        });
        attachmentsImported += 1;
        continue;
      }
      const result = await ingestKnowledgeBuffer({
        organizationId: input.organizationId,
        importId: input.importId,
        jobId: input.jobId,
        projectId: resolvedProject?.kind === "project" ? resolvedProject.id : undefined,
        name: attachment.name,
        originalPath: attachment.zipPath,
        bytes,
        parentSourceId: ingested.sourceId,
      });
      if (result.sourceId) attachmentsImported += 1;
    }
  }

  return {
    sourceId: ingested.sourceId,
    itemsCreated: ingested.items,
    memoryUpdates: ingested.memoryUpdates,
    decisions: drafts.filter((item) => item.type === "DECISION").length,
    attachmentsImported,
    tokensPrompt,
  };
}

export type ChatGPTExportConversation = {
  title?: string;
  create_time?: number;
  mapping?: Record<string, unknown>;
};
