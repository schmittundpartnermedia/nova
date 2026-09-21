import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import { decideApproval } from "@/services/approvals";
import { getOrganizationConnectors } from "@/connectors/registry";
import { recordActivity } from "@/services/archive";
import { updateJobStatus } from "@/services/jobs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  approvalId: z.string(),
  decision: z.enum(["approved", "rejected"]),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { approvalId, decision } = bodySchema.parse(json);
    const tenant = await getCurrentTenant();
    const approval = await decideApproval({
      organizationId: tenant.organizationId,
      approvalId,
      status: decision,
    });

    if (decision === "rejected") {
      if (approval.jobId) {
        await updateJobStatus(tenant.organizationId, approval.jobId, "cancelled", {
          completedAt: new Date(),
        });
      }
      await recordActivity({
        organizationId: tenant.organizationId,
        type: "approval",
        title: "Versand abgelehnt",
        description: "Keine E-Mails versendet.",
        status: "prepared",
        jobId: approval.jobId ?? undefined,
      });
      return NextResponse.json({
        ok: true,
        executed: false,
        message: "Abgelehnt. Es wurde nichts versendet.",
      });
    }

    const connectors = await getOrganizationConnectors(tenant.organizationId);
    const payload = JSON.parse(approval.payload) as { communicationIds?: string[] };
    const ids = payload.communicationIds ?? [];

    const sendResult = await connectors.mail.send({
      organizationId: tenant.organizationId,
      to: "unused@mock",
      subject: "batch",
      body: "batch",
    });

    await recordActivity({
      organizationId: tenant.organizationId,
      type: "communication",
      title: "Freigegeben – Connector noch nicht verbunden",
      description: sendResult.reason,
      status: "failed",
      jobId: approval.jobId ?? undefined,
      metadata: { mock: true, executed: false, communicationIds: ids },
    });

    if (approval.jobId) {
      await updateJobStatus(tenant.organizationId, approval.jobId, "completed", {
        completedAt: new Date(),
      });
    }

    await prisma.communication.updateMany({
      where: {
        organizationId: tenant.organizationId,
        id: { in: ids },
      },
      data: {
        status: "prepared",
      },
    });

    return NextResponse.json({
      ok: true,
      executed: false,
      mock: true,
      message: "Freigegeben, aber Connector noch nicht verbunden. Es wurde nichts versendet.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
