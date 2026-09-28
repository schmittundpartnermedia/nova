import { randomUUID } from "node:crypto";
import { runDesktopAction } from "@/services/desktop-service/client";
import type { ActionResult } from "@/lib/computer/types";
import type { ReviewType } from "@/types/workspace";

export type WindowOwnership = {
  previousFrontmost: string | null;
  application: string | null;
  launchedByNova: boolean;
  openedTarget: string;
  rawBefore: unknown;
  rawAfter: unknown;
};

const QUIT_IF_WE_LAUNCHED = new Set(["TextEdit", "Preview", "QuickTime Player"]);

const APP_FOR_REVIEW: Partial<Record<ReviewType, string>> = {
  MAIL_DRAFT: "Mail",
  WEB_RESULT: "Safari",
  WEBSITE: "Safari",
};

function textOf(result: ActionResult): string {
  const value = result.result;
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["stdout", "output", "value", "text", "result"]) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  const data = record.data;
  if (typeof data === "string") return data.trim();
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    if (typeof nested.output === "string") return nested.output.trim();
    if (typeof nested.value === "string") return nested.value.trim();
  }
  return "";
}

function namesOf(result: ActionResult): string[] | null {
  const value = result.result;
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? ((value as Record<string, unknown>).apps ??
          (value as Record<string, unknown>).applications ??
          (value as Record<string, unknown>).items ??
          (value as Record<string, unknown>).data)
      : null;
  if (!Array.isArray(list)) return null;
  const names = list
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && typeof (item as { name?: string }).name === "string") {
        return (item as { name: string }).name;
      }
      return "";
    })
    .filter(Boolean);
  return names.length ? names : null;
}

async function desktop(input: {
  organizationId: string;
  jobId?: string;
  tool: "shell" | "application";
  payload: Record<string, unknown>;
  approvalToken?: string;
}): Promise<ActionResult> {
  return runDesktopAction({
    organizationId: input.organizationId,
    jobId: input.jobId,
    requestId: randomUUID(),
    userCommissioned: true,
    source: "user_intent",
    tool: input.tool,
    payload: input.payload,
    approvalToken: input.approvalToken,
  });
}

async function frontmost(organizationId: string, jobId?: string): Promise<{ name: string | null; raw: unknown }> {
  const result = await desktop({
    organizationId,
    jobId,
    tool: "application",
    payload: {
      action: "runScript",
      source: 'tell application "System Events" to get name of first application process whose frontmost is true',
    },
  });
  const name = textOf(result).split("\n")[0]?.trim() || null;
  return { name: result.success ? name : null, raw: result.result ?? result.error ?? null };
}

export async function openForReview(input: {
  organizationId: string;
  jobId?: string;
  type: ReviewType;
  target: string;
}): Promise<{ ok: boolean; application: string | null; ownership: WindowOwnership; message: string }> {
  const before = await frontmost(input.organizationId, input.jobId);
  const running = await desktop({
    organizationId: input.organizationId,
    jobId: input.jobId,
    tool: "application",
    payload: { action: "listRunning" },
  });
  const runningNames = namesOf(running);
  const preferred = APP_FOR_REVIEW[input.type];
  let opened: ActionResult;
  if (preferred && (input.type === "MAIL_DRAFT" || input.target.startsWith("app:"))) {
    opened = await desktop({
      organizationId: input.organizationId,
      jobId: input.jobId,
      tool: "application",
      payload: { action: "focus", name: preferred },
    });
  } else {
    opened = await desktop({
      organizationId: input.organizationId,
      jobId: input.jobId,
      tool: "shell",
      payload: {
        action: "execute",
        argv: ["open", input.target],
        cwd: process.cwd(),
        purpose: "Review-Ziel öffnen",
        timeoutMs: 15_000,
      },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
  const after = await frontmost(input.organizationId, input.jobId);
  const application = after.name || preferred || null;
  const launchedByNova = Boolean(
    application && runningNames && !runningNames.some((name) => name.toLowerCase() === application.toLowerCase()),
  );
  const ownership: WindowOwnership = {
    previousFrontmost: before.name,
    application,
    launchedByNova,
    openedTarget: input.target,
    rawBefore: before.raw,
    rawAfter: after.raw,
  };
  if (!opened.success) {
    return {
      ok: false,
      application,
      ownership,
      message: opened.error?.message ?? "Fenster konnte nicht geöffnet werden.",
    };
  }
  return { ok: true, application, ownership, message: application ? `Geöffnet in ${application}.` : "Geöffnet." };
}

export async function dismissOwnedReviewWindow(input: {
  organizationId: string;
  jobId?: string;
  sessionId: string;
  ownership: WindowOwnership | null;
}): Promise<{ ok: boolean; message: string }> {
  const ownership = input.ownership;
  if (!ownership) return { ok: true, message: "Kein Fenster von NOVA vorgemerkt." };
  const notes: string[] = [];
  if (
    ownership.launchedByNova &&
    ownership.application &&
    QUIT_IF_WE_LAUNCHED.has(ownership.application)
  ) {
    const quit = await desktop({
      organizationId: input.organizationId,
      jobId: input.jobId,
      tool: "application",
      approvalToken: `review:${input.sessionId}`,
      payload: { action: "quit", name: ownership.application },
    });
    notes.push(quit.success ? `${ownership.application} geschlossen.` : `Schließen nicht möglich: ${quit.error?.message ?? "unbekannt"}`);
  } else if (ownership.application) {
    notes.push(`${ownership.application} bleibt offen, weil das Fenster nicht eindeutig NOVA gehört oder schon lief.`);
  }
  const back = ownership.previousFrontmost && ownership.previousFrontmost !== ownership.application
    ? ownership.previousFrontmost
    : "NOVA";
  const focus = await desktop({
    organizationId: input.organizationId,
    jobId: input.jobId,
    tool: "application",
    payload: { action: "focus", name: back },
  });
  notes.push(focus.success ? `Fokus zurück auf ${back}.` : `Fokus auf ${back} nicht möglich.`);
  return { ok: true, message: notes.join(" ") };
}
