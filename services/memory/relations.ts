import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { RelationType } from "@/types";

export async function relateMemory(input: {
  organizationId: string;
  fromId: string;
  toId: string;
  relationType: RelationType;
  metadata?: Record<string, unknown>;
}) {
  assertOrganizationId(input.organizationId);

  const [from, to] = await Promise.all([
    prisma.memoryEntry.findFirst({ where: { id: input.fromId, organizationId: input.organizationId } }),
    prisma.memoryEntry.findFirst({ where: { id: input.toId, organizationId: input.organizationId } }),
  ]);

  if (!from || !to) {
    throw new Error("Memory-Relation nur innerhalb derselben Organization erlaubt.");
  }

  return prisma.memoryRelation.create({
    data: {
      organizationId: input.organizationId,
      fromId: input.fromId,
      toId: input.toId,
      relationType: input.relationType,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function getRelatedMemory(organizationId: string, memoryId: string) {
  assertOrganizationId(organizationId);
  return prisma.memoryRelation.findMany({
    where: {
      organizationId,
      OR: [{ fromId: memoryId }, { toId: memoryId }],
    },
    include: { from: true, to: true },
  });
}
