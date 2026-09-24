import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { searchConversationMessages } from "@/services/conversation";
import { buildKnowledgeContext } from "@/services/knowledge";
import { DIALOG_HISTORY_SIZE } from "@/types/conversation";
import { loadConversationContinuity } from "@/services/conversation/continuity";
import { embedText, embeddingSimilarity, lexicalMemoryScore, parseEmbedding } from "@/lib/memory/embedding";

export type RetrievalMode = "structured" | "fulltext" | "semantic" | "relation";

export function assertTenantIsolation<T extends { organizationId: string }>(
  organizationId: string,
  rows: T[],
  label = "Datensatz",
): T[] {
  assertOrganizationId(organizationId);
  for (const row of rows) {
    if (row.organizationId !== organizationId) {
      throw new Error(`Tenant isolation: ${label} gehört nicht zur aktuellen Organization.`);
    }
  }
  return rows;
}

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
    const rows = await prisma.memoryEntry.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.type ? { type: input.type } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return assertTenantIsolation(input.organizationId, rows, "Memory");
  }

  if (input.mode === "semantic" || !input.mode) {
    const tokens = q
      .split(/\s+/)
      .map((token) => token.replace(/[^a-zA-Z0-9äöüÄÖÜß-]/g, ""))
      .filter((token) => token.length > 2)
      .slice(0, 8);
    const [lexicalRows, recentRows] = await Promise.all([
      prisma.memoryEntry.findMany({
        where: {
          organizationId: input.organizationId,
          ...(input.type ? { type: input.type } : {}),
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
            { fulltext: { contains: q.toLowerCase() } },
            ...tokens.flatMap((token) => [
              { title: { contains: token } },
              { content: { contains: token } },
              { fulltext: { contains: token.toLowerCase() } },
            ]),
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: 80,
      }),
      prisma.memoryEntry.findMany({
        where: {
          organizationId: input.organizationId,
          ...(input.type ? { type: input.type } : {}),
          embeddingRef: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        take: 150,
      }),
    ]);
    const byId = new Map<string, (typeof lexicalRows)[number]>();
    for (const row of [...lexicalRows, ...recentRows]) {
      if (row.organizationId === input.organizationId) byId.set(row.id, row);
    }
    const candidates = assertTenantIsolation(input.organizationId, Array.from(byId.values()), "Memory");
    let queryVector: number[] = [];
    try {
      queryVector = (await embedText(q)).vector;
    } catch {
      queryVector = [];
    }
    const ranked = candidates
      .map((row) => {
        const lexical = lexicalMemoryScore(q, row.title, row.content, row.fulltext);
        const semantic = queryVector.length ? embeddingSimilarity(queryVector, parseEmbedding(row.embeddingRef)) : 0;
        return { row, score: semantic * 0.72 + lexical * 0.28 };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.row);
    if (ranked.length) return ranked;
  }

  if (input.mode === "relation") {
    const matches = await prisma.memoryEntry.findMany({
      where: {
        organizationId: input.organizationId,
        fulltext: { contains: q.toLowerCase() },
      },
      take: 5,
    });
    assertTenantIsolation(input.organizationId, matches, "Memory");
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
      if (rel.from.organizationId === input.organizationId) related.set(rel.from.id, rel.from);
      if (rel.to.organizationId === input.organizationId) related.set(rel.to.id, rel.to);
    }
    return Array.from(related.values()).slice(0, limit);
  }

  const tokens = q
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9äöüÄÖÜß-]/g, ""))
    .filter((token) => token.length > 2)
    .slice(0, 8);

  const rows = await prisma.memoryEntry.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.type ? { type: input.type } : {}),
      OR: [
        { title: { contains: q } },
        { content: { contains: q } },
        { fulltext: { contains: q.toLowerCase() } },
        ...tokens.flatMap((token) => [
          { title: { contains: token } },
          { content: { contains: token } },
          { fulltext: { contains: token.toLowerCase() } },
        ]),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return assertTenantIsolation(input.organizationId, rows, "Memory");
}

export type BusinessContextPack = {
  organizationName: string;
  memories: Array<{ type: string; title: string; content: string }>;
  projects: Array<{ id: string; name: string; description: string | null; status: string }>;
  companies: Array<{ id: string; name: string; industry: string | null; notes: string | null }>;
  contacts: Array<{ id: string; name: string; role: string | null; company: string | null }>;
  tasks: Array<{ id: string; title: string; status: string; dueAt: Date | null }>;
  meetings: Array<{ id: string; title: string; startsAt: Date }>;
  recentMessages: Array<{ role: string; content: string }>;
  retrievedMessages: Array<{ role: string; content: string; createdAt: string }>;
  knowledge: string;
  continuity: string;
  promptBlock: string;
};

export async function loadRelevantBusinessContext(input: {
  organizationId: string;
  query: string;
  conversationId?: string;
  mode?: "full" | "social";
}): Promise<BusinessContextPack> {
  assertOrganizationId(input.organizationId);
  const query = input.mode === "social" ? "" : input.query.trim();

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
  });
  if (!organization || organization.id !== input.organizationId) {
    throw new Error("Organization nicht gefunden oder Tenant mismatch.");
  }

  const social = input.mode === "social";
  const [memories, projects, companies, contacts, tasks, recentMessages, retrievedMessages, knowledge, continuity] = await Promise.all([
    social ? Promise.resolve([]) : searchMemory({ organizationId: input.organizationId, query, limit: 10 }),
    social
      ? Promise.resolve([])
      : prisma.project.findMany({
          where: { organizationId: input.organizationId },
          orderBy: { updatedAt: "desc" },
          take: 15,
        }),
    social
      ? Promise.resolve([])
      : prisma.company.findMany({
          where: {
            organizationId: input.organizationId,
            ...(query
              ? {
                  OR: [
                    { name: { contains: query } },
                    { notes: { contains: query } },
                    { industry: { contains: query } },
                  ],
                }
              : {}),
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
    social
      ? Promise.resolve([])
      : prisma.contact.findMany({
          where: {
            organizationId: input.organizationId,
            ...(query
              ? {
                  OR: [
                    { firstName: { contains: query } },
                    { lastName: { contains: query } },
                    { notes: { contains: query } },
                    { role: { contains: query } },
                  ],
                }
              : {}),
          },
          include: { company: true },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
    social
      ? Promise.resolve([])
      : prisma.task.findMany({
          where: {
            organizationId: input.organizationId,
            ...(query
              ? {
                  OR: [{ title: { contains: query } }, { description: { contains: query } }],
                }
              : { status: "open" }),
          },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
    input.conversationId
      ? prisma.conversationMessage.findMany({
          where: {
            organizationId: input.organizationId,
            conversationId: input.conversationId,
          },
          orderBy: { createdAt: "desc" },
          take: DIALOG_HISTORY_SIZE,
        })
      : Promise.resolve([]),
    query
      ? searchConversationMessages({
          organizationId: input.organizationId,
          query,
          limit: 6,
        })
      : Promise.resolve([]),
    query
      ? buildKnowledgeContext({ organizationId: input.organizationId, query, limit: 8 })
      : Promise.resolve({ promptBlock: "", hits: [], contradictions: [], answer: "" }),
    loadConversationContinuity({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
    }),
  ]);

  assertTenantIsolation(input.organizationId, projects, "Projekt");
  assertTenantIsolation(input.organizationId, companies, "Firma");
  assertTenantIsolation(input.organizationId, contacts, "Kontakt");
  assertTenantIsolation(input.organizationId, tasks, "Aufgabe");
  assertTenantIsolation(input.organizationId, recentMessages, "Nachricht");
  assertTenantIsolation(
    input.organizationId,
    retrievedMessages.map((item) => ({ organizationId: item.organizationId })),
    "Gespräch",
  );

  const meetingRows = social
    ? []
    : await prisma.meeting.findMany({
        where: {
          organizationId: input.organizationId,
          startsAt: { gte: new Date() },
        },
        orderBy: { startsAt: "asc" },
        take: 6,
      });
  assertTenantIsolation(input.organizationId, meetingRows, "Termin");

  const pack: BusinessContextPack = {
    organizationName: organization.name,
    memories: memories.map((item) => ({
      type: item.type,
      title: item.title,
      content: item.content.slice(0, 400),
    })),
    projects: projects.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      status: item.status,
    })),
    companies: companies.map((item) => ({
      id: item.id,
      name: item.name,
      industry: item.industry,
      notes: item.notes,
    })),
    contacts: contacts.map((item) => ({
      id: item.id,
      name: `${item.firstName} ${item.lastName}`.trim(),
      role: item.role,
      company: item.company?.name ?? null,
    })),
    tasks: tasks.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      dueAt: item.dueAt,
    })),
    meetings: meetingRows.map((item) => ({
      id: item.id,
      title: item.title,
      startsAt: item.startsAt,
    })),
    recentMessages: [...recentMessages].reverse().map((item) => ({
      role: item.role,
      content: item.content.slice(0, 400),
    })),
    retrievedMessages: retrievedMessages.map((item) => ({
      role: item.role,
      content: item.content.slice(0, 400),
      createdAt: item.createdAt,
    })),
    knowledge: knowledge.promptBlock,
    continuity: continuity.promptBlock,
    promptBlock: "",
  };

  pack.promptBlock = formatContextPack(pack);
  return pack;
}

function formatContextPack(pack: BusinessContextPack): string {
  const socialOnly =
    pack.projects.length === 0 &&
    pack.memories.length === 0 &&
    pack.companies.length === 0 &&
    pack.contacts.length === 0 &&
    pack.tasks.length === 0 &&
    pack.meetings.length === 0 &&
    !pack.knowledge;
  const lines: string[] = [`Organization: ${pack.organizationName}`];
  if (pack.continuity) {
    lines.push("", pack.continuity);
  }
  if (!socialOnly) {
    lines.push(
      "",
      "Projekte:",
      pack.projects.length
        ? pack.projects.map((item) => `- ${item.name} (${item.status})${item.description ? `: ${item.description}` : ""}`).join("\n")
        : "- keine gespeichert",
      "",
      "Memory (Retrieval, nicht vollständig):",
      pack.memories.length
        ? pack.memories.map((item) => `- [${item.type}] ${item.title}: ${item.content}`).join("\n")
        : "- nichts passendes gefunden",
      "",
      "Firmen (Treffer/aktuell):",
      pack.companies.length
        ? pack.companies.map((item) => `- ${item.name}${item.industry ? ` (${item.industry})` : ""}`).join("\n")
        : "- keine Treffer",
      "",
      "Kontakte (Treffer/aktuell):",
      pack.contacts.length
        ? pack.contacts.map((item) => `- ${item.name}${item.role ? `, ${item.role}` : ""}${item.company ? ` @ ${item.company}` : ""}`).join("\n")
        : "- keine Treffer",
      "",
      "Aufgaben:",
      pack.tasks.length
        ? pack.tasks.map((item) => `- ${item.title} (${item.status}${item.dueAt ? `, fällig ${item.dueAt.toISOString().slice(0, 10)}` : ""})`).join("\n")
        : "- keine offenen Treffer",
      "",
      "Termine:",
      pack.meetings.length
        ? pack.meetings.map((item) => `- ${item.startsAt.toISOString().slice(0, 16).replace("T", " ")} ${item.title}`).join("\n")
        : "- keine anstehenden",
    );
  }

  if (pack.knowledge) {
    lines.push("", pack.knowledge);
  }

  if (pack.recentMessages.length > 0) {
    lines.push("", "Aktuelle Conversation (Ausschnitt, nicht die komplette Historie):");
    for (const message of pack.recentMessages) {
      lines.push(`- ${message.role}: ${message.content}`);
    }
  }

  if (pack.retrievedMessages.length > 0) {
    lines.push("", "Gefundene Gesprächsstellen (Archive-Retrieval):");
    for (const message of pack.retrievedMessages) {
      lines.push(`- ${message.createdAt.slice(0, 16)} ${message.role}: ${message.content}`);
    }
  }

  const block = lines.join("\n");
  return block.length > 8000 ? `${block.slice(0, 8000)}\n[Kontext gekürzt]` : block;
}
