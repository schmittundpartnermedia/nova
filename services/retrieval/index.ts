import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export type RetrievalMode = "structured" | "fulltext" | "semantic" | "relation";

export async function searchMemory(input: {
  organizationId: string;
  query: string;
  type?: string;
  mode?: RetrievalMode;
  limit?: number;
}) {
  assertOrganizationId(input.organizationId);
  const limit = input.limit ?? 20;
  const q = input.query.trim();

  if (!q) {
    return prisma.memoryEntry.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.type ? { type: input.type } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  if (input.mode === "semantic") {
    // V1: semantische Suche ist vorbereitet, fällt auf Fulltext zurück.
    // embeddingRef bleibt ungenutzt, bis ein Embedding-Store angebunden wird.
  }

  if (input.mode === "relation") {
    const matches = await prisma.memoryEntry.findMany({
      where: {
        organizationId: input.organizationId,
        fulltext: { contains: q.toLowerCase() },
      },
      take: 5,
    });
    const ids = matches.map((m) => m.id);
    if (ids.length === 0) return [];
    const relations = await prisma.memoryRelation.findMany({
      where: {
        organizationId: input.organizationId,
        OR: [{ fromId: { in: ids } }, { toId: { in: ids } }],
      },
      include: { from: true, to: true },
      take: limit,
    });
    const related = new Map<string, (typeof matches)[number]>();
    for (const rel of relations) {
      related.set(rel.from.id, rel.from);
      related.set(rel.to.id, rel.to);
    }
    return Array.from(related.values()).slice(0, limit);
  }

  return prisma.memoryEntry.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.type ? { type: input.type } : {}),
      OR: [
        { title: { contains: q } },
        { content: { contains: q } },
        { fulltext: { contains: q.toLowerCase() } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
