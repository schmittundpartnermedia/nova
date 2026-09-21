import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { executeBridgeTool, bridgeToolNames } from "@/bridge/api/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ tool: string[] }> };

export async function GET() {
  const tenant = await getCurrentTenant();
  return NextResponse.json({
    ok: true,
    organizationId: tenant.organizationId,
    tools: bridgeToolNames,
    note: "Jedes Tool ist auf genau eine Organization begrenzt.",
  });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const tenant = await getCurrentTenant();
    const { tool } = await context.params;
    const toolName = (tool ?? []).join(".");
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await executeBridgeTool({
      organizationId: tenant.organizationId,
      tool: toolName,
      payload,
    });
    return NextResponse.json({ ok: true, organizationId: tenant.organizationId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
