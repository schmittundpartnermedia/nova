import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import { importChatGPTExport, type ChatGPTExportConversation } from "@/services/import/chatgpt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  conversations: z.array(z.record(z.string(), z.unknown())),
});

export async function POST(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const json = await request.json();
    const parsed = bodySchema.parse(json);
    const result = await importChatGPTExport({
      organizationId: tenant.organizationId,
      conversations: parsed.conversations as ChatGPTExportConversation[],
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
