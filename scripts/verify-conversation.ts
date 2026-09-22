import { PrismaClient } from "@prisma/client";
import {
  appendMessage,
  getOrCreateActiveConversation,
  getVisibleContextWindow,
  searchConversationMessages,
  selectContextWindow,
} from "@/services/conversation";
import { upsertDurableMemory } from "@/services/memory";
import { searchMemory } from "@/services/retrieval";
import { recordConversationTurn } from "@/services/archive";

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  if (!organization) {
    throw new Error("Seed fehlt. Bitte zuerst prisma migrate + seed ausführen.");
  }

  const isolation = await prisma.organization.upsert({
    where: { slug: "verify-conversation-isolation" },
    update: {},
    create: { name: "Verify Conversation Isolation", slug: "verify-conversation-isolation" },
  });

  const leakedBefore = await prisma.conversationMessage.count({
    where: { organizationId: isolation.id },
  });

  const conversation = await getOrCreateActiveConversation(organization.id);

  const userText = await appendMessage({
    organizationId: organization.id,
    conversationId: conversation.id,
    role: "user",
    content: "Bei Hetzner wollen wir zunächst drei Monate testen und danach auf zwölf Monate gehen.",
    inputMode: "text",
  });

  const assistantText = await appendMessage({
    organizationId: organization.id,
    conversationId: conversation.id,
    role: "assistant",
    content: "Verstanden. Hetzner startet mit einer Pilotphase von drei Monaten.",
    inputMode: "text",
  });

  const userVoice = await appendMessage({
    organizationId: organization.id,
    conversationId: conversation.id,
    role: "user",
    content: "Was hatten wir zu ELEVUM beschlossen?",
    inputMode: "voice",
  });

  const assistantVoice = await appendMessage({
    organizationId: organization.id,
    conversationId: conversation.id,
    role: "assistant",
    content: "Zur ELEVUM-Entscheidung liegt der Kontext im Archiv, nicht nur auf dem Bildschirm.",
    inputMode: "voice",
  });

  await recordConversationTurn({
    organizationId: organization.id,
    conversationId: conversation.id,
    userMessageId: userText.id,
    assistantMessageId: assistantText.id,
    inputMode: "text",
    userContent: userText.content,
    assistantContent: assistantText.content,
  });

  const memory = await upsertDurableMemory({
    organizationId: organization.id,
    type: "decision",
    title: "Hetzner Pilotphase",
    content: "Alliance Partner Hetzner: Pilot 3 Monate, danach mögliche Verlängerung auf 12 Monate.",
    sourceType: "conversation_message",
    sourceReference: userText.id,
    conversationMessageId: userText.id,
  });

  const confirmed = await upsertDurableMemory({
    organizationId: organization.id,
    type: "decision",
    title: "Hetzner Pilotphase",
    content: "Alliance Partner Hetzner: Pilot 3 Monate, danach mögliche Verlängerung auf 12 Monate.",
    sourceType: "conversation_message",
    sourceReference: userText.id,
    conversationMessageId: userText.id,
  });

  const reloaded = await getOrCreateActiveConversation(organization.id);
  const persisted = await prisma.conversationMessage.findMany({
    where: { organizationId: organization.id, conversationId: reloaded.id },
    orderBy: { createdAt: "asc" },
  });
  const window = await getVisibleContextWindow({
    organizationId: organization.id,
    conversationId: reloaded.id,
  });
  const found = await searchConversationMessages({
    organizationId: organization.id,
    query: "Hetzner",
    limit: 10,
  });
  const memoryHits = await searchMemory({
    organizationId: organization.id,
    query: "Hetzner",
    limit: 10,
  });
  const leaked = await prisma.conversationMessage.count({
    where: { organizationId: isolation.id },
  });
  const foreignMemory = memoryHits.filter((item) => item.organizationId !== organization.id);
  const isolatedSearch = await searchConversationMessages({
    organizationId: isolation.id,
    query: "Hetzner",
    limit: 10,
  });

  const visibleIds = new Set(window.map((item) => item.id));
  const oldStillArchived = persisted.some((item) => item.id === userText.id);
  const contextClipped = selectContextWindow(persisted, 4).length <= 4;

  const checks = {
    conversationPersistence: reloaded.id === conversation.id && persisted.length >= 4,
    userTextStored: persisted.some((item) => item.id === userText.id && item.role === "user" && item.inputMode === "text"),
    userVoiceStored: persisted.some((item) => item.id === userVoice.id && item.inputMode === "voice"),
    novaResponseStored:
      persisted.some((item) => item.id === assistantText.id) &&
      persisted.some((item) => item.id === assistantVoice.id),
    voiceVisible: userVoice.visible === true && assistantVoice.visible === true,
    textVisible: userText.visible === true && assistantText.visible === true,
    contextWindow: window.every((item) => item.visible) && contextClipped,
    oldMessageRemains: oldStillArchived,
    reloadPersistence: persisted.some((item) => item.id === userText.id) && persisted.some((item) => item.id === userVoice.id),
    conversationSearch: found.some((item) => item.id === userText.id),
    memoryExtraction: Boolean(memory?.id),
    memorySourceTraceability:
      memory?.sourceType === "conversation_message" &&
      memory.sourceReference === userText.id &&
      memory.conversationMessageId === userText.id,
    memoryDedup: Boolean(confirmed && memory && confirmed.id === memory.id && confirmed.version >= 2),
    tenantIsolation: leaked === leakedBefore && isolatedSearch.length === 0 && foreignMemory.length === 0,
    voiceInContext: visibleIds.has(userVoice.id) && visibleIds.has(assistantVoice.id),
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  console.log(
    JSON.stringify(
      {
        conversationId: conversation.id,
        userTextId: userText.id,
        assistantTextId: assistantText.id,
        memoryId: memory?.id ?? null,
        checks,
        failed: failed.map(([key]) => key),
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    throw new Error(`Conversation-Verifikation fehlgeschlagen: ${failed.map(([key]) => key).join(", ")}`);
  }

  console.log("NOVA Conversation-Verifikation erfolgreich.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
