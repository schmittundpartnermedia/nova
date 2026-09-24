import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { buildWatchAlert, scanWatch } from "@/agents/watch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const scan = await scanWatch(tenant.organizationId);
    const alert = buildWatchAlert(scan);
    return NextResponse.json({
      ok: true,
      ...alert,
      honesty: "Watch spricht nur, solange die NOVA-Oberfläche offen ist. Kein Hintergrund-Daemon.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
