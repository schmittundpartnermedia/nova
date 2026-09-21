import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { MemoryType, SourceType } from "@/types";

export type SaveMemoryInput = {
  organizationId: string;
  type: MemoryType;
  title: string;
  content: string;
  projectId?: string;
  companyId?: string;
  contactId?: string;
  sourceId?: string;
  sourceType: SourceType;
  sourceReference?: string;
  sourceUrl?: string;
  conversationMessageId?: string;
};

function memoryFulltext(input: Pick<SaveMemoryInput, "title" | "content" | "type" | "sourceType">) {
  return [input.title, input.content, input.type, input.sourceType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export async function saveMemory(input: SaveMemoryInput) {
  assertOrganizationId(input.organizationId);

  return prisma.memoryEntry.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      content: input.content,
      projectId: input.projectId,
      companyId: input.companyId,
      contactId: input.contactId,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference,
      sourceUrl: input.sourceUrl,
      conversationMessageId: input.conversationMessageId,
      fulltext: memoryFulltext(input),
    },
  });
}

export async function upsertDurableMemory(input: SaveMemoryInput) {
  assertOrganizationId(input.organizationId);
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) return null;

  const existing = await prisma.memoryEntry.findFirst({
    where: {
      organizationId: input.organizationId,
      type: input.type,
      title,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (existing) {
    const sameContent = existing.content === content;
    return prisma.memoryEntry.update({
      where: { id: existing.id },
      data: {
        content: sameContent ? existing.content : content,
        fulltext: memoryFulltext({ ...input, title, content: sameContent ? existing.content : content }),
        sourceId: input.sourceId ?? existing.sourceId,
        sourceType: input.sourceType,
        sourceReference: input.sourceReference ?? existing.sourceReference,
        sourceUrl: input.sourceUrl ?? existing.sourceUrl,
        conversationMessageId: input.conversationMessageId ?? existing.conversationMessageId,
        projectId: input.projectId ?? existing.projectId,
        companyId: input.companyId ?? existing.companyId,
        contactId: input.contactId ?? existing.contactId,
        version: { increment: 1 },
      },
    });
  }

  return saveMemory({ ...input, title, content });
}

export async function getMemory(organizationId: string, id: string) {
  assertOrganizationId(organizationId);
  return prisma.memoryEntry.findFirst({
    where: { id, organizationId },
    include: {
      fromRelations: { include: { to: true } },
      toRelations: { include: { from: true } },
      source: true,
      conversationMessage: true,
    },
  });
}

export async function createSource(input: {
  organizationId: string;
  type: SourceType;
  reference?: string;
  url?: string;
  label?: string;
  jobId?: string;
  canonicalUrl?: string;
  title?: string;
  domain?: string;
  publishedAt?: Date | string | null;
  retrievedAt?: Date | string | null;
  provider?: string;
  excerpt?: string;
  trustTier?: string;
  trustScore?: number;
  metadata?: Record<string, unknown> | string | null;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.source.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      reference: input.reference,
      url: input.url,
      label: input.label,
      jobId: input.jobId,
      canonicalUrl: input.canonicalUrl,
      title: input.title,
      domain: input.domain,
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
      retrievedAt: input.retrievedAt ? new Date(input.retrievedAt) : undefined,
      provider: input.provider,
      excerpt: input.excerpt,
      trustTier: input.trustTier,
      trustScore: input.trustScore,
      metadata: typeof input.metadata === "string" ? input.metadata : input.metadata ? JSON.stringify(input.metadata) : undefined,
    },
  });
}
