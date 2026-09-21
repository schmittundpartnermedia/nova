import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { runMaster } from "@/agents/master";
import { getOrCreateActiveConversation, appendMessage } from "@/services/conversation";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { message } = bodySchema.parse(json);
    const tenant = await getCurrentTenant();
    const conversation = await getOrCreateActiveConversation(tenant.organizationId);
    await appendMessage({
      organizationId: tenant.organizationId,
      conversationId: conversation.id,
      role: "user",
      content: message,
    });

    const result = await runMaster({
      organizationId: tenant.organizationId,
      userRequest: message,
    });

    await appendMessage({
      organizationId: tenant.organizationId,
      conversationId: conversation.id,
      role: "assistant",
      content: result.reply,
    });

    return NextResponse.json({
      ok: true,
      organizationId: tenant.organizationId,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json(
      {
        ok: false,
        orbState: "ERROR",
        statusMessage: "Etwas ist schiefgelaufen.",
        error: message,
      },
      { status: 500 },
    );
  }
}
