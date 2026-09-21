import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import {
  getOrCreateActiveConversation,
  getVisibleContextWindow,
  searchConversationMessages,
} from "@/services/conversation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const conversation = await getOrCreateActiveConversation(tenant.organizationId);

    if (query.trim()) {
      const messages = await searchConversationMessages({
        organizationId: tenant.organizationId,
        query,
        conversationId: conversation.id,
        limit: 20,
      });
      return NextResponse.json({
        ok: true,
        conversationId: conversation.id,
        title: conversation.title,
        lastActivityAt: conversation.lastActivityAt,
        messages,
        search: true,
      });
    }

    const window = await getVisibleContextWindow({
      organizationId: tenant.organizationId,
      conversationId: conversation.id,
    });

    return NextResponse.json({
      ok: true,
      conversationId: conversation.id,
      title: conversation.title,
      lastActivityAt: conversation.lastActivityAt,
      startedAt: conversation.startedAt,
      status: conversation.status,
      messages: window,
      search: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
