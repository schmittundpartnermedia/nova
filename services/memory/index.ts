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
};

export async function saveMemory(input: SaveMemoryInput) {
  assertOrganizationId(input.organizationId);

  const fulltext = [input.title, input.content, input.type, input.sourceType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

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
      fulltext,
    },
  });
}

export async function getMemory(organizationId: string, id: string) {
  assertOrganizationId(organizationId);
  return prisma.memoryEntry.findFirst({
    where: { id, organizationId },
    include: {
      fromRelations: { include: { to: true } },
      toRelations: { include: { from: true } },
      source: true,
    },
  });
}

export async function createSource(input: {
  organizationId: string;
  type: SourceType;
  reference?: string;
  url?: string;
  label?: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.source.create({
    data: {
      organizationId: input.organizationId,
      type: input.type,
      reference: input.reference,
      url: input.url,
      label: input.label,
    },
  });
}
