import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { createSource, saveMemory } from "@/services/memory";

export type ChatGPTExportConversation = {
  title?: string;
  create_time?: number;
  mapping?: Record<
    string,
    {
      message?: {
        author?: { role?: string };
        content?: { parts?: unknown[] };
      };
    }
  >;
};

/**
 * Import pipeline (V1 Grundstruktur):
 * Raw Chat → Conversation → Analyse (Platzhalter) → strukturierte Memory-Kandidaten
 *
 * Es werden NICHT alle Rohnachrichten als Memory gespeichert.
 */
export async function importChatGPTExport(input: {
  organizationId: string;
  conversations: ChatGPTExportConversation[];
}) {
  assertOrganizationId(input.organizationId);

  const source = await createSource({
    organizationId: input.organizationId,
    type: "chatgpt",
    label: "ChatGPT Export",
    reference: `import-${Date.now()}`,
  });

  let importedConversations = 0;
  let extractedInsights = 0;

  for (const conversation of input.conversations.slice(0, 50)) {
    const created = await prisma.conversation.create({
      data: {
        organizationId: input.organizationId,
        title: conversation.title ?? "ChatGPT Konversation",
        origin: "chatgpt_import",
      },
    });
    importedConversations += 1;

    const texts: string[] = [];
    if (conversation.mapping) {
      for (const node of Object.values(conversation.mapping)) {
        const role = node.message?.author?.role ?? "unknown";
        const parts = node.message?.content?.parts ?? [];
        const content = parts
          .filter((part): part is string => typeof part === "string")
          .join("\n")
          .trim();
        if (!content) continue;
        texts.push(content);
        await prisma.conversationMessage.create({
          data: {
            organizationId: input.organizationId,
            conversationId: created.id,
            role,
            content,
          },
        });
      }
    }

    const combined = texts.join("\n").slice(0, 4000);
    if (combined.length > 80) {
      await saveMemory({
        organizationId: input.organizationId,
        type: "conversation_insight",
        title: conversation.title ?? "ChatGPT-Zusammenfassung (Rohimport)",
        content:
          "V1 speichert nur eine nachvollziehbare Quelle plus Kurztext. Eine echte Business-Extraktion (Personen, Firmen, Entscheidungen) folgt später.",
        sourceId: source.id,
        sourceType: "chatgpt",
        sourceReference: created.id,
      });
      extractedInsights += 1;
    }
  }

  return {
    sourceId: source.id,
    importedConversations,
    extractedInsights,
    note: "Pipeline vorbereitet. Transcript → Conversation Archive. Dauerhaftes Wissen folgt über den Knowledge Agent, nicht als blinde Memory-Übernahme aller Nachrichten.",
  };
}
