import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { cancelComputerWork } from "@/agents/computer";
import { updateJobStatus } from "@/services/jobs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const tenant = await getCurrentTenant();
    const result = await cancelComputerWork(tenant.organizationId);
    const running = await prisma.job.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: { in: ["running", "planning"] },
      },
      select: { id: true },
      take: 20,
    });
    for (const job of running) {
      await updateJobStatus(tenant.organizationId, job.id, "cancelled", { completedAt: new Date() });
    }
    return NextResponse.json({
      ok: true,
      status: "CANCELLED_BY_USER",
      cancelledJobs: result.count,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
