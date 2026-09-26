import { prisma } from "@/lib/prisma";
import { classifyReviewUtterance } from "@/lib/review/intent";
import { recordActivity } from "@/services/archive";
import { decideApproval } from "@/services/approvals";
import { markArtifactStatus } from "@/services/artifacts";
import { isRealConnectorEnabled } from "@/connectors/registry";
import { deliverApprovedDraft } from "@/services/mail/send";
import { setJobExecution } from "@/services/jobs";
import { closeReviewWindow, findActiveReview } from "@/services/review";
import { applyDevelopmentReview } from "@/services/development/review";
import { cancelWorkItem, completeWorkItem, pauseWorkItem } from "@/services/worker/queue";
import type { OrbState } from "@/types";

export type ReviewHandleResult = {
  jobId: string;
  status: string;
  orbState: OrbState;
  statusMessage: string;
  reply: string;
  approvalId?: string;
  actionType?: string;
};

async function linkedWorkItem(organizationId: string, sessionId: string) {
  return prisma.workItem.findFirst({
    where: { organizationId, idempotencyKey: `review:${sessionId}` },
  });
}

async function fulfillMailApproval(input: {
  organizationId: string;
  approvalId: string;
  alsoSend: boolean;
}): Promise<{ sent: number; message: string; actionType?: string }> {
  const approval = await prisma.approvalRequest.findFirst({
    where: { id: input.approvalId, organizationId: input.organizationId },
  });
  if (!approval) return { sent: 0, message: "Keine verknüpfte Freigabe." };
  if (!input.alsoSend) return { sent: 0, message: "Freigabe bleibt offen, bis ein Versand ausdrücklich gesagt wird.", actionType: approval.actionType };
  if (approval.status !== "pending") {
    return { sent: 0, message: "Die Freigabe war bereits entschieden. Es wurde nichts erneut versendet.", actionType: approval.actionType };
  }
  if (!approval.actionType.startsWith("mail.")) {
    await decideApproval({ organizationId: input.organizationId, approvalId: approval.id, status: "approved" });
    return { sent: 0, message: "Freigabe gespeichert. Kein Mailversand an diesem Schritt.", actionType: approval.actionType };
  }
  await decideApproval({ organizationId: input.organizationId, approvalId: approval.id, status: "approved" });
  const payload = JSON.parse(approval.payload) as { communicationIds?: string[] };
  const ids = payload.communicationIds ?? [];
  let sent = 0;
  for (const communicationId of ids) {
    const sendResult = await deliverApprovedDraft({
      organizationId: input.organizationId,
      communicationId,
      approved: true,
    });
    if (sendResult.status === "VERIFIED") sent += 1;
  }
  const mailConnected = await isRealConnectorEnabled(input.organizationId, "mail");
  await recordActivity({
    organizationId: input.organizationId,
    type: "communication",
    title: sent ? `${sent} E-Mail(s) nach Prüfung versendet` : "Prüfung freigegeben – nichts versendet",
    description: mailConnected ? "Versand über die bestehende Mail-Freigabe." : "Kein Mailkonto verbunden. Es wurde nichts versendet.",
    status: sent ? "executed" : "prepared",
    actuallyExecutedExternally: sent > 0,
    jobId: approval.jobId ?? undefined,
    metadata: { approvalId: approval.id, sent, communicationIds: ids },
  });
  return {
    sent,
    actionType: approval.actionType,
    message: sent ? `${sent} E-Mail(s) sind raus.` : "Freigegeben. Es wurde nichts versendet.",
  };
}

export async function handleReviewUtterance(input: {
  organizationId: string;
  userRequest: string;
}): Promise<ReviewHandleResult | null> {
  const command = classifyReviewUtterance(input.userRequest);
  if (!command) return null;
  const session = await findActiveReview(input.organizationId);
  if (!session) return null;

  const work = await linkedWorkItem(input.organizationId, session.id);
  const now = new Date();
  const development = await applyDevelopmentReview({
    organizationId: input.organizationId,
    jobId: session.jobId,
    command,
  });
  if (development) {
    await prisma.reviewSession.update({
      where: { id: session.id },
      data: {
        status: command.kind === "changes" ? "CHANGES_REQUESTED" : "APPROVED",
        resolution: input.userRequest.trim(),
        resolvedAt: command.kind === "changes" ? undefined : now,
        instruction: command.kind === "changes" ? command.instruction : undefined,
      },
    });
    if (command.kind !== "changes") {
      if (session.artifactId) {
        await markArtifactStatus({
          organizationId: input.organizationId,
          artifactId: session.artifactId,
          status: "APPROVED",
        });
      }
      await closeReviewWindow({
        organizationId: input.organizationId,
        jobId: session.jobId,
        sessionId: session.id,
        ownership: session.ownership,
      });
    }
    return development;
  }

  if (command.kind === "changes") {
    await prisma.reviewSession.update({
      where: { id: session.id },
      data: { status: "CHANGES_REQUESTED", instruction: command.instruction, resolution: command.instruction },
    });
    await setJobExecution({
      organizationId: input.organizationId,
      jobId: session.jobId,
      status: "waiting_for_review",
      pauseReason: "changes_requested",
      resumeState: JSON.stringify({ reviewSessionId: session.id, instruction: command.instruction }),
    });
    if (work) await pauseWorkItem(work.id, input.organizationId, command.instruction);
    await recordActivity({
      organizationId: input.organizationId,
      type: "review",
      title: "Änderung gewünscht",
      description: command.instruction,
      status: "prepared",
      jobId: session.jobId,
      externalReference: session.id,
    });
    return {
      jobId: session.jobId,
      status: "waiting_for_review",
      orbState: "WAITING_FOR_REVIEW",
      statusMessage: "Ich halte den Auftrag an und merke die Änderung.",
      reply: `Verstanden. Ich ändere noch nichts automatisch. Notiert: ${command.instruction}`,
    };
  }

  if (command.kind === "cancel" || command.kind === "reject") {
    const rejected = command.kind === "reject";
    await prisma.reviewSession.update({
      where: { id: session.id },
      data: {
        status: rejected ? "REJECTED" : "CANCELLED",
        resolvedAt: now,
        resolution: input.userRequest.trim(),
      },
    });
    if (session.artifactId) {
      await markArtifactStatus({
        organizationId: input.organizationId,
        artifactId: session.artifactId,
        status: "REJECTED",
      });
    }
    await setJobExecution({
      organizationId: input.organizationId,
      jobId: session.jobId,
      status: "cancelled",
      completedAt: now,
      pauseReason: null,
    });
    if (work) await cancelWorkItem(work.id, input.organizationId, rejected ? "rejected" : "cancelled");
    const closed = await closeReviewWindow({
      organizationId: input.organizationId,
      jobId: session.jobId,
      sessionId: session.id,
      ownership: session.ownership,
    });
    await recordActivity({
      organizationId: input.organizationId,
      type: "review",
      title: rejected ? "Prüfung abgelehnt" : "Prüfung abgebrochen",
      description: closed.message,
      status: "prepared",
      jobId: session.jobId,
      externalReference: session.id,
    });
    return {
      jobId: session.jobId,
      status: "cancelled",
      orbState: "DONE",
      statusMessage: rejected ? "Abgelehnt." : "Abgebrochen.",
      reply: rejected ? `Abgelehnt. ${closed.message}` : `Abgebrochen. ${closed.message}`,
    };
  }

  const alsoSend = command.kind === "approve" && command.alsoSend;
  const fulfillment = session.approvalRequestId
    ? await fulfillMailApproval({
        organizationId: input.organizationId,
        approvalId: session.approvalRequestId,
        alsoSend,
      })
    : {
        sent: 0,
        message: alsoSend ? "Es gibt hier nichts zu senden. Die Prüfung ist abgeschlossen." : "Prüfung abgeschlossen.",
        actionType: undefined as string | undefined,
      };

  await prisma.reviewSession.update({
    where: { id: session.id },
    data: {
      status: "APPROVED",
      resolvedAt: now,
      resolution: input.userRequest.trim(),
    },
  });
  if (session.artifactId) {
    await markArtifactStatus({
      organizationId: input.organizationId,
      artifactId: session.artifactId,
      status: "APPROVED",
    });
  }
  await setJobExecution({
    organizationId: input.organizationId,
    jobId: session.jobId,
    status: "completed",
    completedAt: now,
    pauseReason: null,
    resumeState: null,
  });
  if (work) await completeWorkItem(work.id, input.organizationId, "review approved");
  const closed = await closeReviewWindow({
    organizationId: input.organizationId,
    jobId: session.jobId,
    sessionId: session.id,
    ownership: session.ownership,
  });
  await recordActivity({
    organizationId: input.organizationId,
    type: "review",
    title: "Prüfung freigegeben",
    description: `${fulfillment.message} ${closed.message}`,
    status: fulfillment.sent > 0 ? "executed" : "prepared",
    actuallyExecutedExternally: fulfillment.sent > 0,
    jobId: session.jobId,
    externalReference: session.id,
    metadata: { reviewSessionId: session.id, artifactId: session.artifactId, sent: fulfillment.sent },
  });
  return {
    jobId: session.jobId,
    status: "completed",
    orbState: "DONE",
    statusMessage: "Prüfung abgeschlossen.",
    reply: `${fulfillment.message} ${closed.message}`.trim(),
    approvalId: alsoSend ? session.approvalRequestId ?? undefined : undefined,
    actionType: fulfillment.actionType,
  };
}
