import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listPendingApprovals, listStandingPolicies, standingActionLabel } from "@/services/approvals";
import { getOrCreateActiveConversation } from "@/services/conversation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const [pending, latestJob, conversation, standing] = await Promise.all([
      listPendingApprovals(tenant.organizationId),
      prisma.job.findFirst({
        where: { organizationId: tenant.organizationId },
        orderBy: { createdAt: "desc" },
        include: { approvalRequests: true, steps: true },
      }),
      getOrCreateActiveConversation(tenant.organizationId),
      listStandingPolicies(tenant.organizationId),
    ]);

    return NextResponse.json({
      ok: true,
      tenant: {
        organizationName: tenant.organizationName,
        userName: tenant.userName,
      },
      pendingApprovals: pending,
      standingPolicies: standing.map((item) => ({
        id: item.id,
        name: item.name,
        actionType: item.actionType,
        label: standingActionLabel(item.actionType),
      })),
      latestJob,
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
