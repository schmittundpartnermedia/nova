import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import {
  decideApproval,
  createStandingPolicy,
  isStandingActionType,
  standingActionLabel,
} from "@/services/approvals";
import { isRealConnectorEnabled } from "@/connectors/registry";
import { deliverApprovedDraft } from "@/services/mail/send";
import { recordActivity } from "@/services/archive";
import { updateJobStatus } from "@/services/jobs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  approvalId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  standing: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { approvalId, decision, standing } = bodySchema.parse(json);
    const tenant = await getCurrentTenant();
    const approval = await decideApproval({
      organizationId: tenant.organizationId,
      approvalId,
      status: decision,
    });

    if (decision === "approved" && standing && isStandingActionType(approval.actionType)) {
      await createStandingPolicy({
        organizationId: tenant.organizationId,
        name: standingActionLabel(approval.actionType),
        actionType: approval.actionType,
        limits: { maxPerDay: approval.actionType === "mail.send.batch" ? 20 : 40 },
      });
    }

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

    const payload = JSON.parse(approval.payload) as { communicationIds?: string[] };
    const ids = payload.communicationIds ?? [];
    const mailConnected = await isRealConnectorEnabled(tenant.organizationId, "mail");
    let sent = 0;
    const reasons: string[] = [];
    for (const communicationId of ids) {
      const sendResult = await deliverApprovedDraft({
        organizationId: tenant.organizationId,
        communicationId,
        approved: true,
      });
      reasons.push(sendResult.reason);
      if (sendResult.status === "VERIFIED") sent += 1;
    }
    if (!ids.length) {
      reasons.push(mailConnected ? "Kein Entwurf in der Freigabe." : "Kein Mailkonto verbunden. Es wurde nichts versendet.");
    }

    await recordActivity({
      organizationId: tenant.organizationId,
      type: "communication",
      title: sent ? `${sent} E-Mail(s) versendet` : "Freigegeben – nichts versendet",
      description: reasons.slice(0, 4).join(" "),
      status: sent ? "executed" : "failed",
      actuallyExecutedExternally: sent > 0,
      jobId: approval.jobId ?? undefined,
      metadata: { mock: !mailConnected, executed: sent > 0, sent, communicationIds: ids },
    });

    if (approval.jobId) {
      await updateJobStatus(tenant.organizationId, approval.jobId, "completed", {
        completedAt: new Date(),
      });
    }

    if (!sent && ids.length) {
      await prisma.communication.updateMany({
        where: {
          organizationId: tenant.organizationId,
          id: { in: ids },
          status: { notIn: ["sent", "failed"] },
        },
        data: { status: "prepared" },
      });
    }

    return NextResponse.json({
      ok: true,
      executed: sent > 0,
      mock: !mailConnected,
      sent,
      message: sent
        ? `${sent} E-Mail(s) sind raus.${standing ? " Dauerfreigabe ist aktiv." : ""}`
        : mailConnected
          ? "Freigegeben, aber der Versand ist fehlgeschlagen. Es wurde nichts als gesendet markiert."
          : "Freigegeben, aber Connector noch nicht verbunden. Es wurde nichts versendet.",
      standing: Boolean(standing && isStandingActionType(approval.actionType)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
