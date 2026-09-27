import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { classifySituationTurn, type SituationDecision, type SituationSnapshot } from "@/lib/dialog/situation";
import { decideApproval } from "@/services/approvals";
import { executeDecidedApproval } from "@/services/approvals/fulfill";
import { explainDevelopment } from "@/services/development/status";
import { pauseAbandonedJobs } from "@/services/jobs/recover";
import { RESUMABLE_COMPUTER_STATUSES } from "@/lib/computer/plan";
import { cancelComputerWork } from "@/agents/computer";
import { findActiveReview } from "@/services/review";
import { desktopHealth } from "@/agents/computer/client";

export type OpenSituation = SituationSnapshot & {
  pendingApprovalId: string | null;
};

const HEARTBEAT = path.join(process.cwd(), ".nova", "worker.heartbeat");

export async function loadOpenSituation(organizationId: string): Promise<OpenSituation> {
  const [approval, review, activity, computer, pausedJob] = await Promise.all([
    prisma.approvalRequest.findFirst({
      where: { organizationId, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
    findActiveReview(organizationId),
    prisma.activity.findFirst({
      where: { organizationId },
      orderBy: { timestamp: "desc" },
    }),
    prisma.computerJob.findFirst({
      where: {
        organizationId,
        cancelRequested: false,
        status: { in: [...RESUMABLE_COMPUTER_STATUSES] },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.job.findFirst({
      where: {
        organizationId,
        status: "paused",
        NOT: { pauseReason: { contains: "nicht bestätigt" } },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);
  let hardBlocked = false;
  if (approval?.payload) {
    try {
      hardBlocked = JSON.parse(approval.payload).hardBlocked === true;
    } catch {
      hardBlocked = false;
    }
  }
  return {
    pendingApproval: approval ? { actionType: approval.actionType, hardBlocked } : null,
    pendingApprovalId: approval?.id ?? null,
    approvalCreatedAt: approval?.createdAt ?? null,
    reviewOpenedAt: review?.openedAt ?? review?.createdAt ?? null,
    activeReview: Boolean(review),
    resumableComputer: Boolean(computer),
    resumablePausedJob: Boolean(pausedJob),
    lastActivityType: activity?.type ?? null,
  };
}

export function decideTurn(text: string, situation: OpenSituation): SituationDecision {
  return classifySituationTurn(text, situation);
}

async function workerAlive(now = Date.now()): Promise<boolean> {
  try {
    const raw = fs.readFileSync(HEARTBEAT, "utf8");
    const parsed = JSON.parse(raw) as { at?: string };
    if (!parsed.at) return false;
    return now - new Date(parsed.at).getTime() < 30_000;
  } catch {
    return false;
  }
}

async function desktopState(): Promise<"up" | "auth" | "down"> {
  try {
    if (await desktopHealth()) return "up";
  } catch {
    /* health with token failed */
  }
  try {
    const { getDesktopBaseUrl } = await import("@/lib/computer/config");
    const response = await fetch(`${getDesktopBaseUrl()}/health`, { signal: AbortSignal.timeout(800) });
    if (response.status === 401) return "auth";
  } catch {
    return "down";
  }
  return "down";
}

export async function explainOpenWork(organizationId: string, userRequest: string): Promise<string> {
  await pauseAbandonedJobs();
  const [development, pausedJobs, pending, planned, worker, desktop, review, carried] = await Promise.all([
    explainDevelopment(organizationId, userRequest),
    prisma.job.findMany({
      where: { organizationId, status: "paused" },
      select: { pauseReason: true },
    }),
    prisma.approvalRequest.findFirst({
      where: { organizationId, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.developmentOrder.count({ where: { organizationId, status: "planned" } }),
    workerAlive(),
    desktopState(),
    findActiveReview(organizationId),
    prisma.job.count({
      where: {
        organizationId,
        status: "running",
        workItems: { some: { status: { in: ["queued", "leased", "running"] } } },
      },
    }),
  ]);
  const uncertain = pausedJobs.filter((job) => /nicht bestätigt|nicht erneut|unbestätigt/i.test(job.pauseReason ?? "")).length;
  const paused = pausedJobs.length - uncertain;
  const lines = [development.reply];
  if (carried > 0) {
    lines.push(
      worker
        ? carried === 1
          ? "Ein Auftrag läuft beim Worker weiter, unabhängig von dieser Verbindung."
          : `${carried} Aufträge laufen beim Worker weiter, unabhängig von dieser Verbindung.`
        : "Ein Auftrag ist übernommen, der Worker läuft aber gerade nicht. Er bleibt liegen, bis der Worker wieder da ist.",
    );
  }
  if (uncertain > 0) {
    lines.push(
      uncertain === 1
        ? "Eine externe Aktion ist nicht bestätigt. Ich wiederhole sie nicht."
        : `${uncertain} externe Aktionen sind nicht bestätigt. Ich wiederhole sie nicht.`,
    );
  }
  if (paused > 0) {
    lines.push(
      paused === 1
        ? "Ein Auftrag ist angehalten, weil kein Prozess ihn weiterführt."
        : `${paused} Aufträge sind angehalten, weil kein Prozess sie weiterführt.`,
    );
  }
  if (pending) {
    lines.push(`Offene Freigabe: ${pending.actionType}.`);
  }
  if (review) {
    const name = review.target.split("/").filter(Boolean).pop() || "ein Ergebnis";
    lines.push(`Zur Prüfung offen: ${name}.`);
  }
  if (!worker) {
    lines.push("Der Worker läuft nicht. Geplante Entwicklungsaufträge bleiben liegen, bis er wieder läuft.");
  }
  if (planned > 0) {
    lines.push(
      planned === 1
        ? "Ein Entwicklungsauftrag steht noch auf geplant."
        : `${planned} Entwicklungsaufträge stehen noch auf geplant.`,
    );
  }
  if (desktop === "down") {
    lines.push("Der Desktop-Dienst läuft nicht. Mac und Cursor kann ich gerade nicht steuern.");
  } else if (desktop === "auth") {
    lines.push("Der Desktop-Dienst antwortet, weist NOVA aber ab. Mac und Cursor kann ich damit gerade nicht steuern.");
  }
  return lines.join("\n");
}

export async function actOnSituation(input: {
  organizationId: string;
  userRequest: string;
  decision: SituationDecision;
  situation: OpenSituation;
}): Promise<{ reply: string; statusMessage: string; orb: "DONE" | "WAITING_FOR_APPROVAL" | "ERROR"; approvalId?: string } | null> {
  if (input.decision.kind === "none") return null;

  if (input.decision.kind === "status") {
    const reply = await explainOpenWork(input.organizationId, input.userRequest);
    return { reply, statusMessage: "Stand geprüft.", orb: "DONE" };
  }

  if (input.decision.kind === "cancel-active") {
    const cancelled = await cancelComputerWork(input.organizationId);
    await pauseAbandonedJobs();
    const reply =
      cancelled.count > 0
        ? "Ich habe den laufenden Auftrag abgebrochen. Es startet nichts Neues."
        : "Es läuft nichts, das ich abbrechen müsste.";
    return { reply, statusMessage: "Abbruch geprüft.", orb: "DONE" };
  }

  if (input.decision.kind === "reject-pending" && input.situation.pendingApprovalId) {
    const approval = await decideApproval({
      organizationId: input.organizationId,
      approvalId: input.situation.pendingApprovalId,
      status: "rejected",
    });
    const result = await executeDecidedApproval({
      organizationId: input.organizationId,
      approval,
      decision: "rejected",
    });
    return { reply: result.message, statusMessage: "Abgelehnt.", orb: "DONE" };
  }

  if (input.decision.kind === "confirm-pending" && input.situation.pendingApprovalId) {
    const approval = await decideApproval({
      organizationId: input.organizationId,
      approvalId: input.situation.pendingApprovalId,
      status: "approved",
    });
    const result = await executeDecidedApproval({
      organizationId: input.organizationId,
      approval,
      decision: "approved",
    });
    return {
      reply: result.message,
      statusMessage: result.executed ? "Ausgeführt." : "Nicht ausgeführt.",
      orb: result.executed ? "DONE" : "WAITING_FOR_APPROVAL",
      approvalId: approval.id,
    };
  }

  if (input.decision.kind === "resume-computer") {
    const open = await prisma.computerJob.findFirst({
      where: {
        organizationId: input.organizationId,
        cancelRequested: false,
        jobId: { not: null },
        status: { in: ["INTERRUPTED", "FAILED", "WAITING_FOR_HUMAN", "WAITING_FOR_APPROVAL", "EXECUTING"] },
      },
      orderBy: { startedAt: "desc" },
    });
    if (open?.jobId) {
      const { continueOwnedJob } = await import("@/services/jobs/owned");
      const resumed = await continueOwnedJob({
        organizationId: input.organizationId,
        jobId: open.jobId,
        kind: "computer.run",
        idempotencyKey: `computer.run:${open.jobId}:resume:${Date.now()}`,
        payload: { userRequest: "mach weiter" },
      });
      return {
        reply: resumed.reply,
        statusMessage: resumed.statusMessage,
        orb: resumed.orbState === "WAITING_FOR_APPROVAL" ? "WAITING_FOR_APPROVAL" : resumed.orbState === "ERROR" ? "ERROR" : "DONE",
      };
    }
    const paused = await prisma.job.findFirst({
      where: {
        organizationId: input.organizationId,
        status: "paused",
        NOT: { pauseReason: { contains: "nicht bestätigt" } },
      },
      orderBy: { createdAt: "desc" },
      include: { workItems: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (paused) {
      const rawKind = paused.workItems[0]?.kind ?? "planner.run";
      const kind = (
        rawKind === "computer.run" || rawKind === "coding.run" || rawKind === "knowledge.run" || rawKind === "planner.run"
          ? rawKind
          : "planner.run"
      ) as "computer.run" | "coding.run" | "knowledge.run" | "planner.run";
      const { continueOwnedJob } = await import("@/services/jobs/owned");
      const resumed = await continueOwnedJob({
        organizationId: input.organizationId,
        jobId: paused.id,
        kind,
        idempotencyKey: `${kind}:${paused.id}:resume:${Date.now()}`,
        payload: {
          userRequest: paused.userRequest,
          resume: true,
        },
      });
      return {
        reply: resumed.reply || `Ich setze den Auftrag „${paused.goal}“ fort.`,
        statusMessage: resumed.statusMessage || "Auftrag fortgesetzt.",
        orb: resumed.orbState === "WAITING_FOR_APPROVAL" ? "WAITING_FOR_APPROVAL" : resumed.orbState === "ERROR" ? "ERROR" : "DONE",
      };
    }
    const { resumeComputerWork } = await import("@/agents/computer");
    const resumed = await resumeComputerWork({
      organizationId: input.organizationId,
      userRequest: input.userRequest,
    });
    return {
      reply: resumed.reply,
      statusMessage: resumed.statusMessage,
      orb: resumed.status === "WAITING_FOR_APPROVAL" ? "WAITING_FOR_APPROVAL" : resumed.ok ? "DONE" : "ERROR",
      approvalId: resumed.approvalId,
    };
  }

  if (input.decision.kind === "revise-mail") {
    const { prepareMailDraft } = await import("@/services/mail/draft");
    const draft = await prepareMailDraft({
      organizationId: input.organizationId,
      userRequest: input.userRequest,
    });
    return {
      reply: draft.reply,
      statusMessage: draft.ok ? "Entwurf angepasst." : "Entwurf nicht angepasst.",
      orb: draft.approvalId ? "WAITING_FOR_APPROVAL" : "DONE",
      approvalId: draft.approvalId,
    };
  }

  return null;
}
