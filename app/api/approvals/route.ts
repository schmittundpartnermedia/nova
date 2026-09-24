import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import { decideApproval } from "@/services/approvals";
import { getOrganizationConnectors, isRealConnectorEnabled } from "@/connectors/registry";
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

    const payload = JSON.parse(approval.payload) as { communicationIds?: string[] };
    const ids = payload.communicationIds ?? [];
    const mailConnected = await isRealConnectorEnabled(tenant.organizationId, "mail");
    const connectors = await getOrganizationConnectors(tenant.organizationId);
    const drafts = ids.length
      ? await prisma.communication.findMany({
          where: { organizationId: tenant.organizationId, id: { in: ids } },
          include: { contact: true },
        })
      : [];

    let sent = 0;
    const reasons: string[] = [];
    if (mailConnected) {
      for (const draft of drafts) {
        const to = draft.contact?.email?.trim();
        if (!to) {
          reasons.push(`${draft.subject}: kein Empfänger.`);
          continue;
        }
        const sendResult = await connectors.mail.send({
          organizationId: tenant.organizationId,
          to,
          subject: draft.subject,
          body: draft.body,
        });
        reasons.push(sendResult.reason);
        if (sendResult.executed) {
          sent += 1;
          await prisma.communication.update({
            where: { id: draft.id },
            data: { status: "sent", sentAt: new Date(), isMock: false, externalReference: sendResult.messageId ?? undefined },
          });
        }
      }
    } else {
      reasons.push( (await connectors.mail.send({
        organizationId: tenant.organizationId,
        to: "unused@mock",
        subject: "batch",
        body: "batch",
      })).reason);
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
          status: { not: "sent" },
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
        ? `${sent} E-Mail(s) sind raus.`
        : mailConnected
          ? "Freigegeben, aber der Versand ist fehlgeschlagen. Es wurde nichts als gesendet markiert."
          : "Freigegeben, aber Connector noch nicht verbunden. Es wurde nichts versendet.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
