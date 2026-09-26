import { prisma } from "@/lib/prisma";
import { isRealConnectorEnabled } from "@/connectors/registry";
import { deliverApprovedDraft } from "@/services/mail/send";
import { recordActivity } from "@/services/archive";
import { updateJobStatus } from "@/services/jobs";

type ApprovalRow = {
  id: string;
  jobId: string | null;
  actionType: string;
  payload: string;
  description: string;
};

export async function executeDecidedApproval(input: {
  organizationId: string;
  approval: ApprovalRow;
  decision: "approved" | "rejected";
}): Promise<{ executed: boolean; message: string; sent: number }> {
  const mail = input.approval.actionType.startsWith("mail.");
  const computer = input.approval.actionType.startsWith("computer.");
  const payload = JSON.parse(input.approval.payload) as {
    communicationIds?: string[];
    hardBlocked?: boolean;
  };

  if (input.decision === "rejected") {
    if (input.approval.jobId) {
      await updateJobStatus(input.organizationId, input.approval.jobId, "cancelled", {
        completedAt: new Date(),
      });
    }
    if (mail) {
      const ids = payload.communicationIds ?? [];
      if (ids.length) {
        await prisma.communication.updateMany({
          where: { organizationId: input.organizationId, id: { in: ids }, status: { not: "sent" } },
          data: { deliveryStatus: "NOT_SENT", status: "prepared" },
        });
      }
    }
    const message = computer
      ? "Abgelehnt. Die Computeraktion wurde nicht ausgeführt."
      : mail
        ? "Abgelehnt. Es wurde nichts versendet."
        : "Abgelehnt. Es wurde nichts ausgeführt.";
    await recordActivity({
      organizationId: input.organizationId,
      type: computer ? "computer" : "approval",
      title: computer ? "Computeraktion abgelehnt" : "Freigabe abgelehnt",
      description: message,
      status: "prepared",
      jobId: input.approval.jobId ?? undefined,
    });
    return { executed: false, message, sent: 0 };
  }

  if (computer) {
    if (payload.hardBlocked) {
      if (input.approval.jobId) {
        await updateJobStatus(input.organizationId, input.approval.jobId, "cancelled", {
          completedAt: new Date(),
        });
        await prisma.computerJob.updateMany({
          where: {
            organizationId: input.organizationId,
            jobId: input.approval.jobId,
            status: "WAITING_FOR_APPROVAL",
          },
          data: {
            status: "CANCELLED",
            error: "Harte Löschgrenze. Nichts ausgeführt.",
            finishedAt: new Date(),
            cancelRequested: true,
          },
        });
      }
      await recordActivity({
        organizationId: input.organizationId,
        type: "computer",
        title: "Löschen bleibt blockiert",
        description: "Die Freigabe ändert die Sicherheitsgrenze nicht. Es wurde nichts gelöscht.",
        status: "prepared",
        jobId: input.approval.jobId ?? undefined,
        metadata: { approvalId: input.approval.id, executed: false, hardBlocked: true },
      });
      return {
        executed: false,
        sent: 0,
        message: "Die Freigabe ist notiert. Diese Löschung führe ich trotzdem nicht aus. Es wurde nichts gelöscht.",
      };
    }
    if (!input.approval.jobId) {
      return {
        executed: false,
        sent: 0,
        message: "Zu dieser Freigabe gibt es keinen Auftrag. Es wurde nichts ausgeführt.",
      };
    }
    const { continueOwnedJob } = await import("@/services/jobs/owned");
    const resumed = await continueOwnedJob({
      organizationId: input.organizationId,
      jobId: input.approval.jobId,
      kind: "computer.run",
      idempotencyKey: `computer.run:${input.approval.jobId}:approval:${input.approval.id}`,
      payload: { userRequest: "mach weiter", approvalToken: input.approval.id },
    });
    return {
      executed: resumed.status === "completed",
      sent: 0,
      message: resumed.reply,
    };
  }

  if (!mail) {
    await recordActivity({
      organizationId: input.organizationId,
      type: "approval",
      title: "Freigabe gespeichert",
      description: "An diesem Schritt gibt es keinen Versand.",
      status: "prepared",
      jobId: input.approval.jobId ?? undefined,
    });
    return {
      executed: false,
      sent: 0,
      message: "Freigabe gespeichert. An diesem Schritt wird nichts versendet.",
    };
  }

  const ids = payload.communicationIds ?? [];
  const mailConnected = await isRealConnectorEnabled(input.organizationId, "mail");
  let sent = 0;
  const reasons: string[] = [];
  for (const communicationId of ids) {
    const sendResult = await deliverApprovedDraft({
      organizationId: input.organizationId,
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
    organizationId: input.organizationId,
    type: "communication",
    title: sent ? `${sent} E-Mail(s) versendet` : "Freigegeben – nichts versendet",
    description: reasons.slice(0, 4).join(" "),
    status: sent ? "executed" : "failed",
    actuallyExecutedExternally: sent > 0,
    jobId: input.approval.jobId ?? undefined,
    metadata: { mock: !mailConnected, executed: sent > 0, sent, communicationIds: ids },
  });
  if (input.approval.jobId) {
    await updateJobStatus(input.organizationId, input.approval.jobId, sent ? "completed" : "failed", {
      completedAt: new Date(),
    });
  }
  if (!sent && ids.length) {
    await prisma.communication.updateMany({
      where: {
        organizationId: input.organizationId,
        id: { in: ids },
        status: { notIn: ["sent", "failed"] },
      },
      data: { status: "prepared" },
    });
  }
  return {
    executed: sent > 0,
    sent,
    message: sent
      ? `${sent} E-Mail(s) sind raus.`
      : mailConnected
        ? "Freigegeben, aber der Versand ist fehlgeschlagen. Es wurde nichts als gesendet markiert."
        : "Freigegeben, aber es ist kein Mailkonto verbunden. Es wurde nichts versendet.",
  };
}
