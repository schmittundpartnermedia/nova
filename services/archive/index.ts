import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { assertActivityStatusHonesty } from "@/lib/honesty";
import { searchConversationMessages } from "@/services/conversation";
import type { ActivityStatus, ActivityType } from "@/types";
import type { ConversationInputMode } from "@/types/conversation";

export type RecordActivityInput = {
  organizationId: string;
  type: ActivityType;
  title: string;
  description?: string;
  status: ActivityStatus;
  actuallyExecutedExternally?: boolean;
  projectId?: string;
  companyId?: string;
  contactId?: string;
  taskId?: string;
  communicationId?: string;
  jobId?: string;
  externalReference?: string;
  externalUrl?: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
};

export async function recordActivity(input: RecordActivityInput) {
  assertOrganizationId(input.organizationId);
  assertActivityStatusHonesty({
    status: input.status,
    actuallyExecutedExternally: Boolean(input.actuallyExecutedExternally),
  });

  return prisma.activity.create({
    data: {
      organizationId: input.organizationId,
      timestamp: input.timestamp ?? new Date(),
      type: input.type,
      title: input.title,
      description: input.description,
      status: input.status,
      projectId: input.projectId,
      companyId: input.companyId,
      contactId: input.contactId,
      taskId: input.taskId,
      communicationId: input.communicationId,
      jobId: input.jobId,
      externalReference: input.externalReference,
      externalUrl: input.externalUrl,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function recordConversationTurn(input: {
  organizationId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId?: string;
  inputMode: ConversationInputMode;
  userContent: string;
  assistantContent?: string;
}) {
  const preview = input.userContent.trim().slice(0, 140);
  return recordActivity({
    organizationId: input.organizationId,
    type: "conversation",
    title: preview ? `Gespräch: ${preview}` : "Gespräch",
    description: [input.userContent.trim(), input.assistantContent?.trim()]
      .filter(Boolean)
      .join("\n\n"),
    status: "prepared",
    metadata: {
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId ?? null,
      inputMode: input.inputMode,
      stored: true,
      visible: input.inputMode === "text",
    },
  });
}

export async function listActivities(input: {
  organizationId: string;
  query?: string;
  type?: string;
  limit?: number;
}) {
  assertOrganizationId(input.organizationId);
  const q = input.query?.trim();

  return prisma.activity.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.type && input.type !== "all" ? { type: input.type } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { company: { is: { name: { contains: q } } } },
              { contact: { is: { firstName: { contains: q } } } },
              { contact: { is: { lastName: { contains: q } } } },
            ],
          }
        : {}),
    },
    orderBy: { timestamp: "desc" },
    take: input.limit ?? 100,
    include: {
      company: true,
      contact: true,
      task: true,
      communication: true,
      project: true,
    },
  });
}

export async function listArchive(input: {
  organizationId: string;
  query?: string;
  type?: string;
  limit?: number;
}) {
  const activities = await listActivities(input);
  const type = input.type ?? "all";
  const query = input.query?.trim() ?? "";
  const includeConversation =
    type === "all" || type === "conversation" || Boolean(query);

  if (!includeConversation) return { activities, conversationMessages: [] };

  const conversationMessages =
    type === "conversation" || query
      ? await searchConversationMessages({
          organizationId: input.organizationId,
          query,
          limit: input.limit ?? 100,
        })
      : [];

  return { activities, conversationMessages };
}
