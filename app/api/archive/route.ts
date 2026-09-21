import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listActivities } from "@/services/archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const type = url.searchParams.get("type") ?? "all";
    const activities = await listActivities({
      organizationId: tenant.organizationId,
      query,
      type,
    });
    return NextResponse.json({ ok: true, activities });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
