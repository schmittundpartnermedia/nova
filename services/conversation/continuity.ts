import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { upsertDurableMemory } from "@/services/memory";
import { resolveAIProvider } from "@/providers/ai/registry";
import { DIALOG_HISTORY_SIZE } from "@/types/conversation";

export const THREAD_DIGEST_TITLE = "NOVA Gesprächsfaden";
export const RELATION_TITLE = "NOVA Beziehung";
export const OPEN_THREADS_TITLE = "NOVA offene Fäden";

const TURNS_RE = /^Turns:\s*(\d+)/i;
const REFRESH_EVERY = 6;

export type ConversationContinuity = {
  digest: string;
  relation: string;
  openThreads: string;
  insights: Array<{ title: string; content: string }>;
  recent: Array<{ role: string; content: string }>;
  promptBlock: string;
  messageCount: number;
};

function parseTurnCount(content: string | undefined): number {
  const match = content?.match(TURNS_RE);
  return match ? Number(match[1]) : 0;
}

function formatContinuity(input: Omit<ConversationContinuity, "promptBlock">): string {
  if (!input.digest && !input.relation && !input.openThreads && input.insights.length === 0) {
    return "";
  }
  const lines = ["Gesprächskontinuität (über Sessions, nicht nur die letzten Zeilen):"];
  if (input.digest) {
    lines.push("", "Faden:", input.digest.replace(TURNS_RE, "").trim() || input.digest);
  }
  if (input.relation) {
    lines.push("", "Wie ihr redet:", input.relation);
  }
  if (input.openThreads) {
    lines.push("", "Offen:", input.openThreads);
  }
  if (input.insights.length) {
    lines.push("", "Was über das Gespräch bleibt:");
    for (const item of input.insights) {
      lines.push(`- ${item.title}: ${item.content}`);
    }
  }
  return lines.join("\n");
}

export async function loadConversationContinuity(input: {
  organizationId: string;
  conversationId?: string;
}): Promise<ConversationContinuity> {
  assertOrganizationId(input.organizationId);

  const [digest, relation, open, insights, recent, messageCount] = await Promise.all([
    prisma.memoryEntry.findFirst({
      where: { organizationId: input.organizationId, type: "summary", title: THREAD_DIGEST_TITLE },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.memoryEntry.findFirst({
      where: { organizationId: input.organizationId, type: "preference", title: RELATION_TITLE },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.memoryEntry.findFirst({
      where: { organizationId: input.organizationId, type: "task", title: OPEN_THREADS_TITLE },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.memoryEntry.findMany({
      where: { organizationId: input.organizationId, type: "conversation_insight" },
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
    input.conversationId
      ? prisma.conversationMessage.count({
          where: { organizationId: input.organizationId, conversationId: input.conversationId },
        })
      : Promise.resolve(0),
  ]);

  const pack: Omit<ConversationContinuity, "promptBlock"> = {
    digest: digest?.content ?? "",
    relation: relation?.content ?? "",
    openThreads: open?.content ?? "",
    insights: insights.map((item) => ({ title: item.title, content: item.content.slice(0, 280) })),
    recent: [...recent].reverse().map((item) => ({
      role: item.role,
      content: item.content.slice(0, 400),
    })),
    messageCount,
  };

  return { ...pack, promptBlock: formatContinuity(pack) };
}

export async function refreshConversationContinuity(input: {
  organizationId: string;
  conversationId: string;
  userRequest: string;
  reply: string;
  force?: boolean;
}): Promise<void> {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.memoryEntry.findFirst({
    where: { organizationId: input.organizationId, type: "summary", title: THREAD_DIGEST_TITLE },
    orderBy: { updatedAt: "desc" },
  });
  const count = await prisma.conversationMessage.count({
    where: { organizationId: input.organizationId, conversationId: input.conversationId },
  });
  const previous = parseTurnCount(existing?.content);
  if (!input.force && existing && count - previous < REFRESH_EVERY) return;
  if (!input.force && count < 4) return;

  const recent = await prisma.conversationMessage.findMany({
    where: { organizationId: input.organizationId, conversationId: input.conversationId },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  const thread = [...recent]
    .reverse()
    .map((item) => `${item.role}: ${item.content.slice(0, 280)}`)
    .join("\n");

  const { provider, decision } = await resolveAIProvider(input.organizationId, "simple");
  if (decision.requestedProviderId === "openai" && (decision.fallback || provider.id !== "openai") && provider.id !== "mock") {
    return;
  }

  const extracted = await provider.structuredOutput<{
    digest?: string;
    relation?: string;
    openThreads?: string;
    insights?: Array<{ title?: string; content?: string }>;
  }>({
    model: decision.model,
    schemaName: "conversation-continuity",
    schemaDescription:
      'JSON {digest, relation, openThreads, insights:[{title,content}]}. digest=kompakter Faden über Tage. relation=wie ihr miteinander redet. openThreads=liegengebliebene Themen. insights=langlebige Gesprächsmuster, keine Secrets, kein Smalltalk-Mitschnitt.',
    prompt: `Aktualisiere NOVA's Gesprächsgedächtnis. Nicht erfinden. Keine Secrets.

Bisheriger Faden:
${existing?.content ?? "noch keiner"}

Letzter User: ${input.userRequest}
Letzte Antwort: ${input.reply}

Ausschnitt:
${thread}`,
  });

  const digest = `Turns: ${count}\n${(extracted.digest ?? "").trim()}`.slice(0, 1600);
  await upsertDurableMemory({
    organizationId: input.organizationId,
    type: "summary",
    title: THREAD_DIGEST_TITLE,
    content: digest,
    sourceType: "conversation_message",
    sourceReference: input.conversationId,
  });
  if (extracted.relation?.trim()) {
    await upsertDurableMemory({
      organizationId: input.organizationId,
      type: "preference",
      title: RELATION_TITLE,
      content: extracted.relation.trim().slice(0, 800),
      sourceType: "conversation_message",
      sourceReference: input.conversationId,
    });
  }
  if (extracted.openThreads?.trim()) {
    await upsertDurableMemory({
      organizationId: input.organizationId,
      type: "task",
      title: OPEN_THREADS_TITLE,
      content: extracted.openThreads.trim().slice(0, 800),
      sourceType: "conversation_message",
      sourceReference: input.conversationId,
    });
  }
  for (const item of (extracted.insights ?? []).slice(0, 4)) {
    const title = item.title?.trim();
    const content = item.content?.trim();
    if (!title || !content) continue;
    await upsertDurableMemory({
      organizationId: input.organizationId,
      type: "conversation_insight",
      title: title.slice(0, 80),
      content: content.slice(0, 400),
      sourceType: "conversation_message",
      sourceReference: input.conversationId,
    });
  }
}
