import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { redactSecrets } from "@/lib/secrets";
import { CONTEXT_WINDOW_SIZE } from "@/types/conversation";
import type {
  ConversationInputMode,
  ConversationMessageStatus,
  ConversationRole,
  StoredConversationMessage,
} from "@/types/conversation";

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toStored(message: {
  id: string;
  organizationId: string;
  conversationId: string;
  role: string;
  content: string;
  inputMode: string;
  status: string;
  visible: boolean;
  createdAt: Date;
  metadata: string | null;
}): StoredConversationMessage {
  return {
    id: message.id,
    organizationId: message.organizationId,
    conversationId: message.conversationId,
    role: message.role as ConversationRole,
    content: message.content,
    inputMode: message.inputMode as ConversationInputMode,
    status: message.status as ConversationMessageStatus,
    visible: message.visible,
    stored: true,
    createdAt: message.createdAt.toISOString(),
    metadata: parseMetadata(message.metadata),
  };
}

function messageFulltext(input: {
  role: string;
  inputMode: string;
  content: string;
}): string {
  return [input.role, input.inputMode, input.content].join(" ").toLowerCase();
}

function shouldDisplay(inputMode: ConversationInputMode): boolean {
  return inputMode === "text";
}

export async function getOrCreateActiveConversation(organizationId: string) {
  assertOrganizationId(organizationId);
  const existing = await prisma.conversation.findFirst({
    where: { organizationId, origin: "nova", status: "active" },
    orderBy: { lastActivityAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: {
      organizationId,
      title: "NOVA",
      origin: "nova",
      status: "active",
    },
  });
}

export async function appendMessage(input: {
  organizationId: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  inputMode?: ConversationInputMode;
  status?: ConversationMessageStatus;
  visible?: boolean;
  metadata?: Record<string, unknown>;
}) {
  assertOrganizationId(input.organizationId);
  const content = redactSecrets(input.content.trim());
  if (!content) {
    throw new Error("ConversationMessage braucht einen Inhalt.");
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
  });
  if (!conversation) {
    throw new Error("Conversation gehört nicht zur aktuellen Organization.");
  }

  const inputMode = input.inputMode ?? "text";
  const visible = input.visible ?? shouldDisplay(inputMode);
  const created = await prisma.conversationMessage.create({
    data: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      role: input.role,
      content,
      inputMode,
      status: input.status ?? "final",
      visible,
      fulltext: messageFulltext({ role: input.role, inputMode, content }),
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });

  const title =
    conversation.title && conversation.title !== "NOVA"
      ? conversation.title
      : input.role === "user"
        ? content.slice(0, 80)
        : conversation.title;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastActivityAt: created.createdAt,
      ...(title ? { title } : {}),
    },
  });

  return toStored(created);
}

export async function searchConversationMessages(input: {
  organizationId: string;
  query: string;
  conversationId?: string;
  limit?: number;
}) {
  assertOrganizationId(input.organizationId);
  const q = input.query.trim();
  const limit = input.limit ?? 20;
  if (!q) {
    return prisma.conversationMessage.findMany({
      where: {
        organizationId: input.organizationId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }).then((rows) => rows.map(toStored));
  }

  const tokens = q
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9äöüÄÖÜß-]/g, ""))
    .filter((token) => token.length > 2)
    .slice(0, 8);

  const rows = await prisma.conversationMessage.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      OR: [
        { content: { contains: q } },
        { fulltext: { contains: q.toLowerCase() } },
        ...tokens.flatMap((token) => [
          { content: { contains: token } },
          { fulltext: { contains: token.toLowerCase() } },
        ]),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(toStored);
}

export function selectContextWindow<T>(messages: T[], limit = CONTEXT_WINDOW_SIZE): T[] {
  if (messages.length <= limit) return messages;
  return messages.slice(messages.length - limit);
}

export async function getVisibleContextWindow(input: {
  organizationId: string;
  conversationId: string;
  limit?: number;
}) {
  assertOrganizationId(input.organizationId);
  const rows = await prisma.conversationMessage.findMany({
    where: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      visible: true,
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? CONTEXT_WINDOW_SIZE,
  });
  return [...rows].reverse().map(toStored);
}

export async function getConversationForTenant(input: {
  organizationId: string;
  conversationId: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
  });
}
