import { randomUUID } from "node:crypto";
import { detectComputerIntent, type ComputerIntent } from "@/agents/computer/intent";
import { planComputerTask } from "@/agents/computer/planner";
import { cancelDesktopJobs, fetchCapabilities, runDesktopAction } from "@/agents/computer/client";
import {
  createComputerJob,
  hasCancelRequest,
  recordComputerAction,
  requestComputerCancel,
  updateComputerJob,
} from "@/services/computer/audit";
import { createApprovalRequest } from "@/services/approvals";
import { recordActivity } from "@/services/archive";
import { cancelCodingSessions } from "@/services/coding/sessions";
import { requestKnowledgeCancel } from "@/services/knowledge/jobs";
import { classifyComputerAction } from "@/lib/computer/risk";
import { detectHardBlock } from "@/lib/computer/hard-blocks";
import { isInjectionAttempt, wrapExternalContent } from "@/lib/computer/injection";
import { redactSecrets } from "@/lib/computer/redaction";
import type { NovaAgent } from "@/types/agents";
import type { ActionResult, ComputerJobStatus } from "@/lib/computer/types";

export type ComputerAgentResult = {
  ok: boolean;
  status: ComputerJobStatus;
  summary: string;
  reply: string;
  approvalId?: string;
  actions: ActionResult[];
  verified: boolean;
  statusMessage: string;
};

const cancelWaiters = new Set<string>();

export function noteCancelOrganization(organizationId: string): void {
  cancelWaiters.add(organizationId);
}

export function consumeCancelOrganization(organizationId: string): boolean {
  const hit = cancelWaiters.has(organizationId);
  cancelWaiters.delete(organizationId);
  return hit;
}

export const computerAgent: NovaAgent = {
  definition: {
    id: "computer",
    name: "Computer Agent",
    description: "Lokale Computersteuerung über den NOVA Desktop Service. Nicht der Master.",
    capabilities: ["computer-use", "filesystem", "shell", "process", "cursor", "browser", "macos"],
    requiredTools: ["nova-desktop-service"],
    inputSchema: { userRequest: "string" },
    outputSchema: { status: "ComputerJobStatus", verified: "boolean" },
    riskLevel: "high",
    implemented: true,
  },
  async run(input, context) {
    const userRequest = String(input.userRequest ?? context.userRequest);
    const result = await runComputerAgent({
      organizationId: context.organizationId,
      jobId: context.jobId,
      userRequest,
      onStatus: () => undefined,
    });
    return {
      ok: result.ok,
      summary: result.summary,
      data: {
        computerStatus: result.status,
        verified: result.verified,
        approvalId: result.approvalId ?? null,
        reply: result.reply,
        actions: result.actions,
      },
    };
  },
};

export async function runComputerAgent(input: {
  organizationId: string;
  jobId?: string;
  userRequest: string;
  onStatus?: (message: string) => void;
}): Promise<ComputerAgentResult> {
  const intent = detectComputerIntent(input.userRequest);
  input.onStatus?.(intent.statusMessage || "Computeraktion wird vorbereitet");

  if (intent.kind === "cancel" || consumeCancelOrganization(input.organizationId)) {
    const count = await requestComputerCancel(input.organizationId);
    await requestKnowledgeCancel(input.organizationId);
    await cancelDesktopJobs();
    return {
      ok: true,
      status: "CANCELLED_BY_USER",
      summary: `${count} Computerjob(s) abgebrochen.`,
      reply: "Ich habe den laufenden Computerjob abgebrochen. Es werden keine neuen Schritte gestartet.",
      actions: [],
      verified: true,
      statusMessage: "Abgebrochen",
    };
  }

  const injection = isInjectionAttempt(input.userRequest);
  const hard = detectHardBlock(input.userRequest);
  if (injection || hard?.code === "ssh_exfil" || hard?.code === "credential_extraction" || hard?.code === "secret_to_model") {
    wrapExternalContent("webpage-or-external", input.userRequest);
    return {
      ok: true,
      status: "FAILED",
      summary: "Untrusted Content oder harte Sicherheitsgrenze blockiert.",
      reply:
        "Das ist untrusted Inhalt, keine Anweisung an mich. Ich lade keine SSH-Schlüssel hoch, umgehe keine Sicherheitsregeln und führe solche Aufforderungen nicht aus.",
      actions: [],
      verified: true,
      statusMessage: "Blockiert",
    };
  }

  const workspace = process.cwd();
  const computerJob = await createComputerJob({
    organizationId: input.organizationId,
    jobId: input.jobId,
    goal: intent.statusMessage || input.userRequest,
    userRequest: input.userRequest,
    status: "PLANNED",
  });

  const caps = await fetchCapabilities();
  const steps = planComputerTask({ kind: intent.kind, userRequest: input.userRequest, workspace });
  await updateComputerJob({
    organizationId: input.organizationId,
    id: computerJob.id,
    status: "EXECUTING",
    plan: steps,
  });

  if (intent.kind === "delete_dangerous" || hard?.code === "delete_repository") {
    const approval = await createApprovalRequest({
      organizationId: input.organizationId,
      jobId: input.jobId,
      actionType: "computer.filesystem.delete_recursive",
      description:
        "NOVA soll das NOVA-Projekt löschen. Das ist eine zerstörende Aktion und wird nicht ausgeführt. Freigabe wäre nötig, automatisch passiert nichts.",
      payload: {
        path: workspace,
        recursive: true,
        executed: false,
        hardBlocked: true,
      },
    });
    await updateComputerJob({
      organizationId: input.organizationId,
      id: computerJob.id,
      status: "WAITING_FOR_APPROVAL",
      result: { blocked: true },
      finished: true,
    });
    await recordActivity({
      organizationId: input.organizationId,
      type: "computer",
      title: "Löschen blockiert – Freigabe erforderlich",
      description: "Das NOVA-Projekt wurde nicht gelöscht.",
      status: "prepared",
      jobId: input.jobId,
      metadata: { approvalId: approval.id, executed: false, computerStatus: "WAITING_FOR_APPROVAL" },
    });
    return {
      ok: true,
      status: "WAITING_FOR_APPROVAL",
      summary: "Zerstörendes Löschen blockiert.",
      reply:
        "Das lösche ich nicht. Ein rekursives Löschen des NOVA-Projekts ist eine harte Sicherheitsgrenze. Es wurde nichts gelöscht. Dafür wäre eine ausdrückliche Freigabe nötig.",
      approvalId: approval.id,
      actions: [],
      verified: true,
      statusMessage: "Freigabe erforderlich",
    };
  }

  const actions: ActionResult[] = [];
  try {
    for (const step of steps) {
      if (await hasCancelRequest(input.organizationId, computerJob.id)) {
        await cancelDesktopJobs();
        return cancelledResult(actions);
      }

      const argv = Array.isArray((step.payload as { argv?: unknown }).argv)
        ? ((step.payload as { argv: string[] }).argv)
        : undefined;
      const risk = classifyComputerAction({
        tool: step.tool,
        action: String((step.payload as { action?: string }).action ?? ""),
        target: String((step.payload as { path?: string; url?: string }).path ?? (step.payload as { url?: string }).url ?? ""),
        argv,
        userCommissioned: step.userCommissioned,
      });

      if (risk.hardBlocked || (risk.approvalRequired && risk.approvalClass === "C" && step.tool === "filesystem")) {
        const approval = await createApprovalRequest({
          organizationId: input.organizationId,
          jobId: input.jobId,
          actionType: `computer.${step.tool}.${String((step.payload as { action?: string }).action ?? "action")}`,
          description: risk.reason,
          payload: { step, executed: false },
        });
        await updateComputerJob({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "WAITING_FOR_APPROVAL",
          finished: true,
        });
        return {
          ok: true,
          status: "WAITING_FOR_APPROVAL",
          summary: risk.reason,
          reply: `${risk.reason} Es wurde nichts ausgeführt.`,
          approvalId: approval.id,
          actions,
          verified: true,
          statusMessage: "Freigabe erforderlich",
        };
      }

      if (intent.kind === "cursor_ask" && String((step.payload as { action?: string }).action) === "ask") {
        const available = actions.find((item) => item.action === "available");
        const discovery = available?.result as { available?: boolean } | undefined;
        if (!discovery?.available) {
          continue;
        }
      }

      const result = await runDesktopAction({
        organizationId: input.organizationId,
        jobId: input.jobId,
        requestId: randomUUID(),
        source: "nova_plan",
        tool: step.tool,
        payload: step.payload,
        userCommissioned: step.userCommissioned,
      });
      actions.push(result);
      await recordComputerAction({
        organizationId: input.organizationId,
        jobId: input.jobId,
        action: result,
      });

      if (!result.success && result.error?.code === "approval_required") {
        const approval = await createApprovalRequest({
          organizationId: input.organizationId,
          jobId: input.jobId,
          actionType: `computer.${step.tool}`,
          description: result.error.message,
          payload: { step, executed: false },
        });
        await updateComputerJob({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "WAITING_FOR_APPROVAL",
          finished: true,
        });
        return {
          ok: true,
          status: "WAITING_FOR_APPROVAL",
          summary: result.error.message,
          reply: `${result.error.message} Es wurde nichts Unfreigegebenes ausgeführt.`,
          approvalId: approval.id,
          actions,
          verified: true,
          statusMessage: "Freigabe erforderlich",
        };
      }

      if (intent.kind === "start_dev" && step.tool === "process") {
        const extra = await maybeStartNovaDev({
          organizationId: input.organizationId,
          jobId: input.jobId,
          workspace,
          listed: result,
        });
        actions.push(...extra);
        for (const item of extra) {
          await recordComputerAction({ organizationId: input.organizationId, jobId: input.jobId, action: item });
        }
      }

      if (intent.kind === "open_local" && step.tool === "browser" && !result.success) {
        await updateComputerJob({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "FAILED",
          error: result.error?.message,
          finished: true,
        });
        return {
          ok: false,
          status: "FAILED",
          summary: "Lokale Seite nicht verifiziert erreichbar.",
          reply: `Ich habe versucht, die lokale NOVA-Seite zu öffnen. Die Erreichbarkeit war nicht verifiziert: ${result.error?.message ?? result.verification?.details ?? "unbekannt"}. Ich behaupte deshalb nicht, dass sie funktioniert.`,
          actions,
          verified: false,
          statusMessage: "Nicht verifiziert",
        };
      }

      if (!result.success && result.error?.code === "cursor_unavailable") {
        continue;
      }

      if (!result.success && intent.kind !== "cursor_ask") {
        await updateComputerJob({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "FAILED",
          error: result.error?.message,
          result: { actions },
          finished: true,
        });
        return {
          ok: false,
          status: "FAILED",
          summary: result.error?.message ?? "Computeraktion fehlgeschlagen.",
          reply: `Die Computeraktion ist fehlgeschlagen: ${result.error?.message ?? "unbekannt"}. Es gilt nicht als erledigt.`,
          actions,
          verified: false,
          statusMessage: "Fehlgeschlagen",
        };
      }
    }

    const verified = actions.length > 0 && actions.every((item) => item.success === false || item.verification?.verified);
    const allVerifiedSuccess = actions.filter((item) => item.success).every((item) => item.verification?.verified);
    const status: ComputerJobStatus = verified && allVerifiedSuccess && actions.some((item) => item.success)
      ? "VERIFIED"
      : actions.some((item) => item.success)
        ? "EXECUTED"
        : "FAILED";

    await updateComputerJob({
      organizationId: input.organizationId,
      id: computerJob.id,
      status,
      result: { actions, capabilities: caps.capabilities.filter((item) => item.status === "AVAILABLE").map((item) => item.id) },
      finished: true,
    });
    await recordActivity({
      organizationId: input.organizationId,
      type: "computer",
      title: status === "VERIFIED" ? "Computeraktion verifiziert" : "Computeraktion nicht vollständig verifiziert",
      description: redactSecrets(summarize(intent, actions)),
      status: "prepared",
      jobId: input.jobId,
      metadata: { computerStatus: status, verified: status === "VERIFIED" },
    });

    return {
      ok: status === "VERIFIED",
      status,
      summary: summarize(intent, actions),
      reply: userReply(intent, actions, status, caps.permissions.map((item) => item.message)),
      actions,
      verified: status === "VERIFIED",
      statusMessage: status === "VERIFIED" ? "Geprüft" : "Nicht vollständig verifiziert",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Computer Agent Fehler";
    await updateComputerJob({
      organizationId: input.organizationId,
      id: computerJob.id,
      status: "FAILED",
      error: message,
      finished: true,
    });
    return {
      ok: false,
      status: "FAILED",
      summary: message,
      reply: `Die Computeraktion ist fehlgeschlagen: ${message}`,
      actions,
      verified: false,
      statusMessage: "Fehlgeschlagen",
    };
  }
}

export async function cancelComputerWork(organizationId: string): Promise<{ count: number }> {
  noteCancelOrganization(organizationId);
  const count = await requestComputerCancel(organizationId);
  const coding = await cancelCodingSessions(organizationId);
  const knowledge = await requestKnowledgeCancel(organizationId);
  await cancelDesktopJobs();
  return { count: count + coding + knowledge };
}

function cancelledResult(actions: ActionResult[]): ComputerAgentResult {
  return {
    ok: true,
    status: "CANCELLED_BY_USER",
    summary: "Abgebrochen.",
    reply: "Ich habe den laufenden Computerjob abgebrochen.",
    actions,
    verified: true,
    statusMessage: "Abgebrochen",
  };
}

async function maybeStartNovaDev(input: {
  organizationId: string;
  jobId?: string;
  workspace: string;
  listed: ActionResult;
}): Promise<ActionResult[]> {
  const processes = ((input.listed.result as { processes?: Array<{ pid: number; command: string; ports: number[] }> })
    ?.processes ?? []);
  const existing = processes.find(
    (item) =>
      item.ports.includes(3000) ||
      /next-server|next dev|next\s+dev/i.test(item.command),
  );
  if (existing) {
    return [];
  }
  const started = await runDesktopAction({
    organizationId: input.organizationId,
    jobId: input.jobId,
    requestId: randomUUID(),
    source: "nova_plan",
    tool: "process",
    payload: {
      action: "start",
      argv: ["npm", "run", "dev"],
      cwd: input.workspace,
      purpose: "NOVA lokalen Dev Server starten",
    },
    userCommissioned: true,
  });
  let listed = started;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    listed = await runDesktopAction({
      organizationId: input.organizationId,
      jobId: input.jobId,
      requestId: randomUUID(),
      source: "nova_plan",
      tool: "process",
      payload: { action: "list", query: "next" },
      userCommissioned: true,
    });
    const found = ((listed.result as { processes?: Array<{ command: string; ports: number[] }> })?.processes ?? []).some(
      (item) => item.ports.includes(3000) || /next/i.test(item.command),
    );
    if (found) break;
  }
  return [started, listed];
}

function summarize(intent: ComputerIntent, actions: ActionResult[]): string {
  const ok = actions.filter((item) => item.success && item.verification?.verified).length;
  return `${intent.kind}: ${ok}/${actions.length} Schritte verifiziert.`;
}

function userReply(
  intent: ComputerIntent,
  actions: ActionResult[],
  status: ComputerJobStatus,
  permissionNotes: string[],
): string {
  if (status !== "VERIFIED") {
    const lastError = [...actions].reverse().find((item) => !item.success)?.error?.message;
    return `Ich habe die Computeraufgabe nicht als erledigt markiert.${lastError ? ` Grund: ${lastError}` : ""} ${permissionNotes.find((note) => /benötigt/i.test(note)) ?? ""}`.trim();
  }
  if (intent.kind === "inspect_project") {
    const statusAction = actions.find((item) => item.action === "execute" && item.target?.includes("git status"));
    const diffAction = actions.find((item) => item.target?.includes("git diff"));
    const statusOut = String((statusAction?.result as { stdout?: string })?.stdout ?? "").trim() || "(keine Ausgabe)";
    const diffOut = String((diffAction?.result as { stdout?: string })?.stdout ?? "").trim() || "keine Diff-Statistik";
    return `Ich habe den Stand des NOVA-Projekts geprüft – verifiziert über git, ohne GUI.\n\nGit-Status:\n${statusOut.slice(0, 2500)}\n\nÄnderungen:\n${diffOut.slice(0, 1500)}`;
  }
  if (intent.kind === "start_dev") {
    const listed = [...actions].reverse().find((item) => item.tool === "process" && item.action === "list");
    const processes = ((listed?.result as { processes?: Array<{ pid: number; command: string; ports: number[] }> })?.processes ?? []);
    const match = processes.find((item) => item.ports.includes(3000) || /next/i.test(item.command));
    if (match) {
      return `NOVA läuft lokal. Verifiziert: PID ${match.pid}, Ports ${match.ports.join(", ") || "unbekannt"}.`;
    }
    return "Ich habe den Dev-Server-Start versucht, konnte den Port aber nicht verifizieren.";
  }
  if (intent.kind === "open_local") {
    const browser = actions.find((item) => item.tool === "browser");
    const statusCode = (browser?.result as { status?: number })?.status;
    return `Ich habe die lokale NOVA-Seite geöffnet und die Erreichbarkeit geprüft. HTTP-Status: ${statusCode ?? "unbekannt"}.`;
  }
  if (intent.kind === "cursor_ask") {
    const available = actions.find((item) => item.action === "available");
    const ask = actions.find((item) => item.action === "ask");
    const discovery = available?.result as { available?: boolean; reason?: string } | undefined;
    if (!discovery?.available) {
      return `${discovery?.reason ?? "Cursor Agent CLI ist auf diesem Mac nicht verfügbar."} Ich habe deshalb keine TypeScript-Analyse von Cursor erhalten.`;
    }
    const output = String((ask?.result as { output?: string })?.output ?? "").trim();
    if (!ask?.success) {
      return ask?.error?.message
        ? ask.error.message
        : "Cursor war erreichbar, hat aber keine verifizierte Antwort geliefert.";
    }
    return output
      ? `Cursor-Antwort (verifiziert empfangen):\n${output.slice(0, 3000)}`
      : "Cursor war erreichbar, hat aber keine verifizierte Antwort geliefert.";
  }
  return `Computeraufgabe mit Status ${status}.`;
}