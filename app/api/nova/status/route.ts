import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listPendingApprovals, listStandingPolicies, standingActionLabel } from "@/services/approvals";
import { getOrCreateActiveConversation } from "@/services/conversation";
import { findResumableComputerJob } from "@/services/computer/audit";
import { buildWatchAlert, scanWatch } from "@/agents/watch";
import { prisma } from "@/lib/prisma";
import { loadNovaWorld } from "@/services/nova/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const [pending, latestJob, conversation, standing, resumable, watchScan, world] = await Promise.all([
      listPendingApprovals(tenant.organizationId),
      prisma.job.findFirst({
        where: { organizationId: tenant.organizationId },
        orderBy: { createdAt: "desc" },
        include: { approvalRequests: true, steps: true },
      }),
      getOrCreateActiveConversation(tenant.organizationId),
      listStandingPolicies(tenant.organizationId),
      findResumableComputerJob(tenant.organizationId),
      scanWatch(tenant.organizationId),
      loadNovaWorld(tenant.organizationId),
    ]);

    const remaining = resumable ? Math.max(0, resumable.plan.steps.length - resumable.plan.cursor) : 0;

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
      resumableComputerJob: resumable
        ? {
            id: resumable.job.id,
            status: resumable.job.status,
            goal: resumable.job.goal,
            remainingSteps: remaining,
            humanRequired: resumable.job.status === "WAITING_FOR_HUMAN" ? resumable.job.error : null,
          }
        : null,
      watchAlert: buildWatchAlert(watchScan),
      world,
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
