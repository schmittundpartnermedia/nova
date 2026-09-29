import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { getOrCreateActiveConversation } from "@/services/conversation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const conversation = await getOrCreateActiveConversation(tenant.organizationId);
    return NextResponse.json({
      ok: true,
      tenant: {
        organizationName: tenant.organizationName,
        userName: tenant.userName,
      },
      conversation: {
        id: conversation.id,
        title: conversation.title,
        lastActivityAt: conversation.lastActivityAt,
        status: conversation.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
