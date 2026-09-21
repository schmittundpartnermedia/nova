import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listPendingApprovals } from "@/services/approvals";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const [pending, latestJob] = await Promise.all([
      listPendingApprovals(tenant.organizationId),
      prisma.job.findFirst({
        where: { organizationId: tenant.organizationId },
        orderBy: { createdAt: "desc" },
        include: { approvalRequests: true, steps: true },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      tenant: {
        organizationName: tenant.organizationName,
        userName: tenant.userName,
      },
      pendingApprovals: pending,
      latestJob,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
