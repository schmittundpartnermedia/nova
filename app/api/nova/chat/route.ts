import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentTenant } from "@/services/tenant";
import { getOrCreateActiveConversation } from "@/services/conversation";
import { chatAnsicht } from "@/services/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Verlauf für das Chatfenster: Nachrichten mit Schritten (Werkzeugprotokoll) und Karten (Entwürfe, Kampagnen). */
export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const conversation = await getOrCreateActiveConversation(tenant.organizationId);
    const rows = await prisma.conversationMessage.findMany({
      where: { organizationId: tenant.organizationId, conversationId: conversation.id, visible: true },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    const nachrichten = await chatAnsicht(tenant.organizationId, rows.reverse());
    return NextResponse.json({ ok: true, conversationId: conversation.id, nachrichten });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
