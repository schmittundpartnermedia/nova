import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

export async function getOrCreateActiveConversation(organizationId: string) {
  assertOrganizationId(organizationId);
  const existing = await prisma.conversation.findFirst({
    where: { organizationId, origin: "nova" },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: {
      organizationId,
      title: "NOVA",
      origin: "nova",
    },
  });
}

export async function appendMessage(input: {
  organizationId: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.conversationMessage.create({
    data: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
    },
  });
}
