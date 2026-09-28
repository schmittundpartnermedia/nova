import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runDesktopAction, cancelDesktopJobs } from "@/services/desktop-service/client";
import { recordComputerAction } from "@/services/computer/audit";
import { recordActivity } from "@/services/archive";
import {
  createCursorSession,
  updateCursorSession,
  hasCodingCancel,
  consumeCodingCancel,
} from "@/services/coding/sessions";
import { loadAndRefreshProjectContext } from "@/services/coding/context";
import { resolveCodingProject } from "@/agents/coding/catalog";
import { verifyProject } from "@/agents/coding/verify";
import { verifyWebsite } from "@/agents/coding/website";
import { redactSecrets } from "@/lib/computer/redaction";
import { wrapExternalContent } from "@/lib/computer/injection";
import { prisma } from "@/lib/prisma";
import type { CodingIntent } from "@/lib/coding/types";
import type { CodingIteration, VerificationCheck } from "@/lib/coding/types";
import type { ActionResult } from "@/lib/computer/types";

const MAX_FIX_ITERATIONS = 3;

export type CodingAgentResult = {
  ok: boolean;
  status: "VERIFIED" | "UNVERIFIED" | "FAILED" | "CANCELLED_BY_USER" | "WAITING_FOR_APPROVAL";
  verified: boolean;
  summary: string;
  reply: string;
  statusMessage: string;
  approvalId?: string;
  sessionId?: string;
  projectPath?: string;
  checks: VerificationCheck[];
  actions: ActionResult[];
};

export async function runCodingWorkflow(input: {
  organizationId: string;
  jobId?: string;
  userRequest: string;
  workspacePath?: string;
  intent: CodingIntent;
  onStatus?: (message: string) => void;
}): Promise<CodingAgentResult> {
  const actions: ActionResult[] = [];
  if (input.intent.kind === "cancel" || consumeCodingCancel(input.organizationId)) {
    await cancelDesktopJobs();
    return cancelled();
  }

  input.onStatus?.("Ich lade den Projektkontext.");
  const website = input.intent.kind === "website_build";
  const resolved =
    input.workspacePath && fs.existsSync(input.workspacePath)
      ? {
          name: path.basename(input.workspacePath),
          localPath: input.workspacePath,
          created: false as const,
          source: "filesystem" as const,
        }
      : await resolveCodingProject({
          organizationId: input.organizationId,
          userRequest: input.userRequest,
          projectHint: input.intent.projectHint,
          createIfMissing: website,
        });

  if ("needsPath" in resolved) {
    return {
      ok: false,
      status: "UNVERIFIED",
      verified: false,
      summary: resolved.reason,
      reply: resolved.reason,
      statusMessage: "Pfad fehlt",
      checks: [],
      actions,
    };
  }

  if (resolved.created) {
    const init = await runDesktopAction({
      organizationId: input.organizationId,
      jobId: input.jobId,
      requestId: randomUUID(),
      source: "nova_plan",
      tool: "shell",
      payload: {
        action: "execute",
        argv: ["git", "init"],
        cwd: resolved.localPath,
        purpose: "Neues Coding-Projekt als Git-Repo initialisieren",
        timeoutMs: 10_000,
      },
      userCommissioned: true,
    });
    actions.push(init);
  }

  const context = await loadAndRefreshProjectContext({
    organizationId: input.organizationId,
    jobId: input.jobId,
    projectId: resolved.projectId,
    name: resolved.name,
    localPath: resolved.localPath,
    userRequest: input.userRequest,
  });

  const session = await createCursorSession({
    organizationId: input.organizationId,
    jobId: input.jobId,
    projectId: context.projectId,
    projectPath: context.localPath,
    repository: context.repository,
    branch: context.branch,
    initialPrompt: input.userRequest,
    metadata: { kind: input.intent.kind, website },
  });

  const available = await cursorAction(input, actions, { action: "available" });
  const discovery = available.result as { available?: boolean; authenticated?: boolean; reason?: string; supportsResume?: boolean } | undefined;
  if (!discovery?.available) {
    await updateCursorSession({ organizationId: input.organizationId, id: session.id, status: "FAILED", lastResult: discovery });
    return fail(actions, discovery?.reason ?? "Cursor Agent CLI ist nicht verfügbar.", session.id, context.localPath);
  }
  if (discovery.authenticated !== true) {
    await updateCursorSession({ organizationId: input.organizationId, id: session.id, status: "FAILED", lastResult: discovery });
    return fail(
      actions,
      "Cursor Agent CLI ist installiert, aber nicht angemeldet. Einmaliger Schritt für Joachim: im Terminal `agent login` ausführen.",
      session.id,
      context.localPath,
    );
  }

  if (await stopIfCancelled(input.organizationId, session.id, actions)) return cancelled(actions, session.id);

  const companyNotes = website ? await loadCompanyNotes(input.organizationId, input.userRequest) : "";
  const iterations: CodingIteration[] = [];
  let cursorSessionId: string | undefined;

  const created = await cursorAction(input, actions, {
    action: "createSession",
    workspace: context.localPath,
  });
  cursorSessionId = String((created.result as { sessionId?: string } | undefined)?.sessionId ?? "") || undefined;

  await updateCursorSession({
    organizationId: input.organizationId,
    id: session.id,
    status: "STARTING",
    cursorSessionId: cursorSessionId ?? null,
  });

  input.onStatus?.("Ich lasse Cursor den Auftrag planen.");
  const planPrompt = buildPlanPrompt({
    request: input.userRequest,
    context,
    companyNotes,
    website,
  });
  const plan = await cursorAction(input, actions, {
    action: "plan",
    workspace: context.localPath,
    task: planPrompt,
    resumeSessionId: cursorSessionId,
    timeoutMs: 120_000,
  });
  rememberIteration(iterations, 0, "PLAN", planPrompt, plan, cursorSessionId);
  cursorSessionId = sessionIdFrom(plan, cursorSessionId);

  if (await stopIfCancelled(input.organizationId, session.id, actions)) return cancelled(actions, session.id);

  input.onStatus?.(website ? "Cursor setzt die Website gerade um." : "Cursor setzt den Auftrag gerade um.");
  await updateCursorSession({ organizationId: input.organizationId, id: session.id, status: "RUNNING", cursorSessionId, iterations });
  const implementPrompt = buildImplementPrompt({ request: input.userRequest, context, companyNotes, website, planOutput: outputOf(plan) });
  const first = await delegate(input, actions, context.localPath, implementPrompt, cursorSessionId);
  rememberIteration(iterations, 1, "DELEGATE", implementPrompt, first, cursorSessionId);
  cursorSessionId = sessionIdFrom(first, cursorSessionId);

  if (!first.success) {
    await updateCursorSession({ organizationId: input.organizationId, id: session.id, status: "FAILED", cursorSessionId, iterations, lastResult: first.result });
    return fail(actions, first.error?.message ?? "Cursor hat den Auftrag nicht ausgeführt.", session.id, context.localPath);
  }

  let verification = await inspectAndVerify(input, actions, context.localPath, website);
  rememberIteration(iterations, iterations.length, "VERIFY", "Projekt prüfen", undefined, cursorSessionId, verification.checks);

  let round = 0;
  while (verification.overall !== "VERIFIED" && round < MAX_FIX_ITERATIONS) {
    if (await stopIfCancelled(input.organizationId, session.id, actions)) return cancelled(actions, session.id);
    round += 1;
    const issues = verification.issues.filter(Boolean);
    input.onStatus?.(
      issues.length
        ? `Ich habe ${issues.length} Fehler gefunden und lasse sie korrigieren.`
        : "Ich lasse Cursor die offenen Punkte korrigieren.",
    );
    await updateCursorSession({ organizationId: input.organizationId, id: session.id, status: "NEEDS_FIX", cursorSessionId, iterations });
    const fixPrompt = buildFixPrompt(verification);
    const fix = await delegate(input, actions, context.localPath, fixPrompt, cursorSessionId);
    rememberIteration(iterations, iterations.length, "FIX", fixPrompt, fix, cursorSessionId);
    cursorSessionId = sessionIdFrom(fix, cursorSessionId);
    verification = await inspectAndVerify(input, actions, context.localPath, website);
    rememberIteration(iterations, iterations.length, "RETEST", "Erneut prüfen", undefined, cursorSessionId, verification.checks);
  }

  const failedStatus = verification.overall === "VERIFIED" ? "COMPLETED" : "FAILED";
  await updateCursorSession({
    organizationId: input.organizationId,
    id: session.id,
    status: failedStatus,
    cursorSessionId,
    iterations,
    lastResult: { overall: verification.overall, checks: verification.checks, gitStatus: verification.gitStatus },
  });

  await recordActivity({
    organizationId: input.organizationId,
    type: "coding",
    title: `Coding: ${resolved.name}`,
    description: redactSecrets(
      [
        `Auftrag: ${input.userRequest}`,
        `Projekt: ${resolved.name} (${context.localPath})`,
        `Cursor-Session: ${cursorSessionId ?? session.id}`,
        `Iterationen: ${iterations.length}`,
        `Verifikation: ${verification.overall}`,
        verification.gitStatus ? `Git:\n${verification.gitStatus.slice(0, 800)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    status: "prepared",
    jobId: input.jobId,
    projectId: context.projectId,
    metadata: {
      cursorSessionDbId: session.id,
      cursorSessionId: cursorSessionId ?? null,
      verified: verification.overall === "VERIFIED",
      checks: verification.checks,
    },
  });

  const reply = userFacingReply(verification, website, resolved.name, Boolean(verification.gitStatus.trim()));
  const codingStatus: CodingAgentResult["status"] =
    verification.overall === "VERIFIED"
      ? "VERIFIED"
      : verification.overall === "UNVERIFIED"
        ? "UNVERIFIED"
        : "FAILED";
  return {
    ok: verification.overall === "VERIFIED",
    status: codingStatus,
    verified: verification.overall === "VERIFIED",
    summary: `${resolved.name}: ${verification.overall}`,
    reply,
    statusMessage: verification.overall === "VERIFIED" ? "Fertig. Prüfung erfolgreich." : "Nicht verifiziert",
    sessionId: session.id,
    projectPath: context.localPath,
    checks: verification.checks,
    actions,
  };
}

async function inspectAndVerify(
  input: { organizationId: string; jobId?: string; onStatus?: (message: string) => void },
  actions: ActionResult[],
  projectPath: string,
  website: boolean,
) {
  input.onStatus?.("Ich prüfe jetzt Git, Tests und bei Bedarf den Browser.");
  const project = await verifyProject({
    organizationId: input.organizationId,
    jobId: input.jobId,
    projectPath,
    includeBuild: true,
  });
  actions.push(...project.actions);
  const issues = project.checks.filter((item) => item.status === "failed" || item.status === "unverified").map((item) => `${item.label}: ${item.details}`);
  if (!website) {
    return { ...project, issues };
  }
  const site = await verifyWebsite({
    organizationId: input.organizationId,
    jobId: input.jobId,
    projectPath,
  });
  actions.push(...site.actions);
  const checks = [...project.checks, ...site.checks];
  const failed = checks.some((item) => item.status === "failed");
  const unverified = checks.some((item) => item.status === "unverified");
  return {
    overall: failed ? "FAILED" : unverified ? "UNVERIFIED" : "VERIFIED",
    checks,
    gitDiff: project.gitDiff,
    gitStatus: project.gitStatus,
    actions: [...project.actions, ...site.actions],
    issues: [...issues, ...site.issues],
  };
}

async function delegate(
  input: { organizationId: string; jobId?: string },
  actions: ActionResult[],
  workspace: string,
  task: string,
  resumeSessionId?: string,
) {
  const payload = resumeSessionId
    ? { action: "resume" as const, workspace, sessionId: resumeSessionId, task, timeoutMs: 8 * 60_000 }
    : { action: "agent" as const, workspace, task, mode: "agent" as const, timeoutMs: 8 * 60_000 };
  return cursorAction(input, actions, payload);
}

async function cursorAction(
  input: { organizationId: string; jobId?: string },
  actions: ActionResult[],
  payload: Record<string, unknown>,
) {
  const result = await runDesktopAction({
    organizationId: input.organizationId,
    jobId: input.jobId,
    requestId: randomUUID(),
    timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
    source: "nova_plan",
    tool: "cursor",
    payload,
    userCommissioned: true,
  });
  actions.push(result);
  if (input.jobId) {
    await recordComputerAction({
      organizationId: input.organizationId,
      jobId: input.jobId,
      action: result,
    });
  }
  return result;
}

async function stopIfCancelled(organizationId: string, sessionId: string, _actions: ActionResult[]): Promise<boolean> {
  if (!(await hasCodingCancel(organizationId, sessionId))) return false;
  await runDesktopAction({
    organizationId,
    requestId: randomUUID(),
    source: "nova_plan",
    tool: "cursor",
    payload: { action: "stop", sessionId },
    userCommissioned: true,
  }).catch(() => undefined);
  await cancelDesktopJobs();
  await updateCursorSession({ organizationId, id: sessionId, status: "CANCELLED_BY_USER" });
  return true;
}

function cancelled(actions: ActionResult[] = [], sessionId?: string): CodingAgentResult {
  return {
    ok: true,
    status: "CANCELLED_BY_USER",
    verified: true,
    summary: "Coding-Auftrag abgebrochen.",
    reply: "Ich habe den Coding-Auftrag abgebrochen. Bereits vorhandene Änderungen bleiben liegen.",
    statusMessage: "Abgebrochen",
    sessionId,
    checks: [],
    actions,
  };
}

function fail(
  actions: ActionResult[],
  message: string,
  sessionId?: string,
  projectPath?: string,
): CodingAgentResult {
  return {
    ok: false,
    status: "FAILED",
    verified: false,
    summary: message,
    reply: message,
    statusMessage: "Fehlgeschlagen",
    sessionId,
    projectPath,
    checks: [],
    actions,
    approvalId: undefined,
  };
}

function rememberIteration(
  iterations: CodingIteration[],
  index: number,
  phase: string,
  prompt: string,
  result?: ActionResult,
  cursorSessionId?: string,
  checks?: VerificationCheck[],
) {
  iterations.push({
    index,
    phase,
    prompt: redactSecrets(prompt).slice(0, 2000),
    cursorSessionId,
    resultSummary: result ? redactSecrets(outputOf(result)).slice(0, 1500) : "Prüfung",
    checks,
  });
}

function outputOf(result: ActionResult): string {
  return String((result.result as { output?: string } | undefined)?.output ?? result.error?.message ?? "");
}

function sessionIdFrom(result: ActionResult, fallback?: string): string | undefined {
  const id = (result.result as { sessionId?: string } | undefined)?.sessionId;
  return id || fallback;
}

function buildPlanPrompt(input: {
  request: string;
  context: { name: string; localPath: string; framework?: string; architecture?: string; rules?: string; lastChanges?: string };
  companyNotes: string;
  website: boolean;
}): string {
  const extra = input.website
    ? "Plane Seitenstruktur, technische Architektur und SEO-Grundgerüst. Frage den Nutzer nicht; nutze vorhandenes Wissen oder sinnvolle Defaults."
    : "Plane die minimale Umsetzung im bestehenden Projekt.";
  return [
    `Projekt: ${input.context.name}`,
    `Pfad: ${input.context.localPath}`,
    input.context.framework ? `Framework: ${input.context.framework}` : "",
    input.context.architecture ? wrapExternalContent("repo-architecture", input.context.architecture).text : "",
    input.context.lastChanges ? `Git: ${input.context.lastChanges}` : "",
    input.companyNotes ? wrapExternalContent("company-memory", input.companyNotes).text : "",
    extra,
    `Auftrag: ${input.request}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildImplementPrompt(input: {
  request: string;
  context: { name: string; localPath: string; framework?: string };
  companyNotes: string;
  website: boolean;
  planOutput: string;
}): string {
  return [
    `Setze den Auftrag im Projekt ${input.context.name} um.`,
    input.website
      ? "Erzeuge eine vollständige lokale Website mit klarer Seitenstruktur, semantischem HTML, SEO-Basis (title, h1, meta description) und ohne externe Veröffentlichung."
      : "Ändere nur, was für den Auftrag nötig ist.",
    input.companyNotes ? wrapExternalContent("company-memory", input.companyNotes).text : "",
    wrapExternalContent("cursor-plan", input.planOutput).text,
    `Auftrag: ${input.request}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFixPrompt(verification: { checks: VerificationCheck[]; issues: string[]; gitDiff: string }): string {
  const failed = verification.checks.filter((item) => item.status === "failed" || item.status === "unverified");
  return [
    "Behebe ausschließlich die folgenden Prüffehler. Keine neuen Features. Kein Push.",
    failed.map((item) => `- ${item.label}: ${item.details.slice(0, 400)}`).join("\n"),
    verification.issues.slice(0, 8).map((item) => `- ${item}`).join("\n"),
    verification.gitDiff ? wrapExternalContent("git-diff", verification.gitDiff.slice(0, 3000)).text : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function userFacingReply(
  verification: { overall: string; checks: VerificationCheck[]; gitStatus: string; issues: string[] },
  website: boolean,
  projectName: string,
  hasGit: boolean,
): string {
  if (verification.overall === "VERIFIED") {
    return website
      ? `Fertig. Build- und Browserprüfung für ${projectName} sind erfolgreich.`
      : `Fertig. Die Prüfung für ${projectName} ist erfolgreich.`;
  }
  const failed = verification.checks.filter((item) => item.status === "failed" || item.status === "unverified");
  const lines = failed.slice(0, 4).map((item) => `${item.label}: nicht verifiziert`);
  return [
    `Ich behaupte nicht, dass es erledigt ist. Status: ${verification.overall}.`,
    lines.join(" "),
    hasGit ? "Die vorhandenen Änderungen bleiben im Arbeitsverzeichnis." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function loadCompanyNotes(organizationId: string, userRequest: string): Promise<string> {
  const tokens = userRequest.split(/\s+/).filter((item) => item.length > 3).slice(0, 4);
  const companies = await prisma.company.findMany({
    where: { organizationId },
    take: 20,
  });
  const match = companies.find((company) => tokens.some((token) => company.name.toLowerCase().includes(token.toLowerCase())));
  if (!match) return "";
  return [`Firma: ${match.name}`, match.industry ? `Branche: ${match.industry}` : "", match.website ? `Website: ${match.website}` : "", match.notes ?? ""]
    .filter(Boolean)
    .join("\n");
}
