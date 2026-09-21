import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listTodayComputerActions } from "@/services/computer/audit";
import { fetchCapabilities } from "@/agents/computer/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const [actions, latest, caps] = await Promise.all([
      listTodayComputerActions(tenant.organizationId),
      prisma.computerJob.findFirst({
        where: { organizationId: tenant.organizationId },
        orderBy: { startedAt: "desc" },
      }),
      fetchCapabilities().catch(() => ({ capabilities: [], permissions: [] })),
    ]);
    return NextResponse.json({
      ok: true,
      latest,
      actions,
      permissions: caps.permissions,
      capabilities: caps.capabilities,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
