import { randomUUID } from "node:crypto";
import { detectComputerIntent, type ComputerIntent } from "@/agents/computer/intent";
import { planComputerTask } from "@/agents/computer/planner";
import { cancelDesktopJobs, fetchCapabilities, runDesktopAction } from "@/agents/computer/client";
import {
  createComputerJob,
  findResumableComputerJob,
  hasCancelRequest,
  interruptStaleComputerJobs,
  recordComputerAction,
  requestComputerCancel,
  saveComputerPlan,
  updateComputerJob,
} from "@/services/computer/audit";
import { pickControlFromInspect } from "@/lib/computer/ax-pick";
import { guessAppName, guessControlName, type PlannedStep } from "@/agents/computer/planner";
import { createApprovalRequest } from "@/services/approvals";
import { recordActivity } from "@/services/archive";
import { cancelCodingSessions } from "@/services/coding/sessions";
import { requestKnowledgeCancel } from "@/services/knowledge/jobs";
import { classifyComputerAction } from "@/lib/computer/risk";
import { detectHardBlock } from "@/lib/computer/hard-blocks";
import { isInjectionAttempt, wrapExternalContent } from "@/lib/computer/injection";
import { redactSecrets } from "@/lib/computer/redaction";
import { detectNamedVolume, unmountedVolumeMessage } from "@/lib/computer/volumes";
import type { NovaAgent } from "@/types/agents";
import type { ActionResult, ComputerJobStatus } from "@/lib/computer/types";

export type ComputerAgentResult = {
  ok: boolean;
  status: ComputerJobStatus;
  summary: string;
  reply: string;
  approvalId?: string;
  humanRequired?: "captcha" | "login";
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
  await interruptStaleComputerJobs(input.organizationId);

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

  const volume = detectNamedVolume(input.userRequest);
  if (volume && !volume.mounted && intent.kind !== "resume") {
    return {
      ok: false,
      status: "FAILED",
      summary: unmountedVolumeMessage(volume),
      reply: unmountedVolumeMessage(volume),
      actions: [],
      verified: true,
      statusMessage: `${volume.name} nicht eingehängt`,
    };
  }
  const workspace = volume?.path ?? process.cwd();
  const caps = await fetchCapabilities();

  let computerJob;
  let steps: PlannedStep[] = [];
  let allSteps: PlannedStep[] = [];
  let startAt = 0;

  if (intent.kind === "resume") {
    const resumable = await findResumableComputerJob(input.organizationId);
    if (!resumable) {
      return {
        ok: false,
        status: "FAILED",
        summary: "Kein unterbrochener Auftrag.",
        reply: "Es liegt kein unterbrochener Computerauftrag vor, den ich fortsetzen könnte.",
        actions: [],
        verified: true,
        statusMessage: "Nichts fortzusetzen",
      };
    }
    computerJob = resumable.job;
    allSteps = resumable.plan.steps;
    startAt = resumable.plan.cursor;
    steps = allSteps.slice(startAt);
    await saveComputerPlan({
      organizationId: input.organizationId,
      id: computerJob.id,
      status: "EXECUTING",
      plan: { steps: resumable.plan.steps, cursor: startAt },
    });
  } else {
    computerJob = await createComputerJob({
      organizationId: input.organizationId,
      jobId: input.jobId,
      goal: intent.statusMessage || input.userRequest,
      userRequest: input.userRequest,
      status: "PLANNED",
    });
    steps = planComputerTask({ kind: intent.kind, userRequest: input.userRequest, workspace });
    allSteps = steps;
    if (intent.kind === "run_script" && steps.length === 0) {
      await updateComputerJob({
        organizationId: input.organizationId,
        id: computerJob.id,
        status: "FAILED",
        error: "invalid_applescript",
        finished: true,
      });
      return {
        ok: false,
        status: "FAILED",
        summary: "Kein ausführbares AppleScript.",
        reply:
          "Ohne ein gültiges tell application … führe ich kein AppleScript aus. do shell script und fremde Apps sind blockiert.",
        actions: [],
        verified: true,
        statusMessage: "Skript abgelehnt",
      };
    }
    await saveComputerPlan({
      organizationId: input.organizationId,
      id: computerJob.id,
      status: "EXECUTING",
      plan: { steps, cursor: 0 },
    });
  }

  if (intent.kind !== "resume" && (intent.kind === "delete_dangerous" || hard?.code === "delete_repository")) {
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
  let cursor = startAt;
  try {
    const queue = [...steps];
    while (queue.length) {
      const step = queue.shift()!;
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
        await saveComputerPlan({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "WAITING_FOR_APPROVAL",
          plan: { steps: allSteps, cursor },
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
      cursor += 1;
      if (!allSteps.includes(step)) allSteps.push(step);
      await saveComputerPlan({
        organizationId: input.organizationId,
        id: computerJob.id,
        status: "EXECUTING",
        plan: { steps: allSteps, cursor },
      });

      const human = String(result.metadata?.humanRequired ?? (result.result as { humanRequired?: string } | undefined)?.humanRequired ?? "");
      if (human === "captcha" || human === "login") {
        await saveComputerPlan({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "WAITING_FOR_HUMAN",
          plan: { steps: allSteps, cursor },
          error: human,
        });
        return {
          ok: true,
          status: "WAITING_FOR_HUMAN",
          summary: human === "captcha" ? "Captcha in der Seite." : "Login in der Seite.",
          reply:
            human === "captcha"
              ? "Da ist ein Captcha. Bitte im NOVA-Browser lösen, dann sag „mach weiter“."
              : "Da ist ein Login. Bitte im NOVA-Browser anmelden, dann sag „mach weiter“.",
          actions,
          verified: true,
          statusMessage: "Du bist dran",
          humanRequired: human === "captcha" ? "captcha" : "login",
        };
      }

      if (
        result.success &&
        step.tool === "accessibility" &&
        String((step.payload as { action?: string }).action) === "inspect" &&
        !queue.some((item) => item.tool === "accessibility" && String((item.payload as { action?: string }).action) === "press")
      ) {
        const picked = pickControlFromInspect(result.result, input.userRequest) || guessControlName(input.userRequest);
        if (picked) {
          queue.push({
            tool: "accessibility",
            payload: { action: "press", identifier: picked, app: guessAppName(input.userRequest) || undefined },
            purpose: `${picked} nach UI-Lesen bedienen`,
            userCommissioned: true,
          });
          queue.push({
            tool: "screen",
            payload: { action: "capture", persist: false },
            purpose: "Selbstprüfung nach UI-Klick",
            userCommissioned: true,
          });
        }
      }

      if (!result.success && result.error?.code === "approval_required") {
        const approval = await createApprovalRequest({
          organizationId: input.organizationId,
          jobId: input.jobId,
          actionType: `computer.${step.tool}`,
          description: result.error.message,
          payload: { step, executed: false },
        });
        await saveComputerPlan({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "WAITING_FOR_APPROVAL",
          plan: { steps: allSteps, cursor: Math.max(0, cursor - 1) },
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
        await saveComputerPlan({
          organizationId: input.organizationId,
          id: computerJob.id,
          status: "FAILED",
          plan: { steps: allSteps, cursor: Math.max(0, cursor - 1) },
          error: result.error?.message,
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
    await saveComputerPlan({
      organizationId: input.organizationId,
      id: computerJob.id,
      status: "INTERRUPTED",
      plan: { steps: allSteps, cursor },
      error: message,
      finished: true,
    });
    return {
      ok: false,
      status: "INTERRUPTED",
      summary: message,
      reply: `Der Auftrag ist unterbrochen: ${message} Sag „mach weiter“, dann setze ich am letzten Schritt an.`,
      actions,
      verified: false,
      statusMessage: "Unterbrochen",
    };
  }
}

export async function resumeComputerWork(input: {
  organizationId: string;
  jobId?: string;
  userRequest?: string;
  onStatus?: (message: string) => void;
}): Promise<ComputerAgentResult> {
  return runComputerAgent({
    organizationId: input.organizationId,
    jobId: input.jobId,
    userRequest: input.userRequest?.trim() || "mach weiter",
    onStatus: input.onStatus,
  });
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
  if (intent.kind === "find_file") {
    const listed = actions.find((item) => item.action === "list");
    const searched = actions.find((item) => item.action === "search");
    const entries = ((listed?.result as { entries?: Array<{ name: string; type: string }>; path?: string })?.entries ?? [])
      .slice(0, 20)
      .map((item) => `- ${item.name}${item.type === "dir" ? "/" : ""}`);
    const matches = ((searched?.result as { matches?: string[] })?.matches ?? []).slice(0, 20);
    const root = String((listed?.result as { path?: string })?.path ?? (searched?.result as { root?: string })?.root ?? "");
    if (entries.length) {
      return `Auf ${root || "der Platte"} liegt:\n${entries.join("\n")}`;
    }
    if (matches.length) {
      return `Gefunden:\n${matches.map((item) => `- ${item}`).join("\n")}`;
    }
    return root ? `Unter ${root} ist nichts Passendes.` : "Keine Dateien gefunden.";
  }
  if (intent.kind === "run_script") {
    const scripted = actions.find((item) => item.action === "runScript");
    const output = String((scripted?.result as { output?: string })?.output ?? "").trim();
    return output
      ? `AppleScript ist gelaufen.\n${output.slice(0, 1500)}`
      : "AppleScript ist gelaufen. Die App hat nichts zurückgegeben.";
  }
  return `Computeraufgabe mit Status ${status}.`;
}
