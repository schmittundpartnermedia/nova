import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { resumeComputerWork } from "@/agents/computer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    let userRequest = "mach weiter";
    try {
      const body = (await request.json()) as { userRequest?: string };
      if (typeof body.userRequest === "string" && body.userRequest.trim()) {
        userRequest = body.userRequest.trim().slice(0, 400);
      }
    } catch {
      // empty body is fine
    }
    const result = await resumeComputerWork({
      organizationId: tenant.organizationId,
      userRequest,
    });
    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      summary: result.summary,
      reply: result.reply,
      approvalId: result.approvalId ?? null,
      verified: result.verified,
      statusMessage: result.statusMessage,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
