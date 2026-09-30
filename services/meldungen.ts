import { prisma } from "@/lib/prisma";
import { appendMessage, getOrCreateActiveConversation } from "@/services/conversation";

/**
 * Meldungen, die NOVA von sich aus macht (Kampagne fertig, Antwort eingegangen, Neustart).
 * Sie landen als Assistenten-Nachricht im aktiven Gespräch – mit Werkzeugprotokoll, damit der Nutzer
 * direkt darauf antworten kann („senden“) – und werden von der Oberfläche einmal angezeigt und vorgelesen.
 */

const KANAL = "nova-meldung";

export async function meldeNutzer(input: {
  organizationId: string;
  text: string;
  werkzeugNotiz?: string;
  anlass: string;
}) {
  const conversation = await getOrCreateActiveConversation(input.organizationId);
  return appendMessage({
    organizationId: input.organizationId,
    conversationId: conversation.id,
    role: "assistant",
    content: input.text,
    inputMode: "system",
    visible: true,
    metadata: {
      channel: KANAL,
      anlass: input.anlass,
      zugestellt: false,
      ...(input.werkzeugNotiz ? { werkzeuge: input.werkzeugNotiz } : {}),
    },
  });
}

/** Neue, noch nicht angezeigte Meldungen; werden dabei als zugestellt markiert. */
export async function holeNeueMeldungen(organizationId: string): Promise<Array<{ id: string; text: string; anlass: string }>> {
  const rows = await prisma.conversationMessage.findMany({
    where: {
      organizationId,
      role: "assistant",
      metadata: { contains: `"channel":"${KANAL}"` },
      createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) },
    },
    orderBy: { createdAt: "asc" },
  });
  const neu = [];
  for (const row of rows) {
    const metadata = JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
    if (metadata.zugestellt) continue;
    await prisma.conversationMessage.update({
      where: { id: row.id },
      data: { metadata: JSON.stringify({ ...metadata, zugestellt: true }) },
    });
    neu.push({ id: row.id, text: row.content, anlass: String(metadata.anlass ?? "") });
  }
  return neu;
}

/** Gab es zu diesem Anlass in den letzten Minuten schon eine Meldung? (verhindert Doppelmeldungen) */
export async function kuerzlichGemeldet(organizationId: string, anlass: string, minuten: number): Promise<boolean> {
  const count = await prisma.conversationMessage.count({
    where: {
      organizationId,
      role: "assistant",
      metadata: { contains: `"anlass":"${anlass}"` },
      createdAt: { gte: new Date(Date.now() - minuten * 60_000) },
    },
  });
  return count > 0;
}
