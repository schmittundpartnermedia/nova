import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { redactSecrets } from "@/lib/computer/redaction";
import { redactUnknown } from "@/lib/computer/redaction";
import type { CursorSessionStatus, CodingIteration } from "@/lib/coding/types";

const ACTIVE_STATUSES: CursorSessionStatus[] = [
  "PENDING",
  "STARTING",
  "RUNNING",
  "WAITING",
  "VERIFYING",
  "NEEDS_FIX",
];

const cancelWaiters = new Set<string>();

export function noteCodingCancel(organizationId: string): void {
  cancelWaiters.add(organizationId);
}

export function consumeCodingCancel(organizationId: string): boolean {
  const hit = cancelWaiters.has(organizationId);
  cancelWaiters.delete(organizationId);
  return hit;
}

export async function createCursorSession(input: {
  organizationId: string;
  jobId?: string;
  projectId?: string;
  projectPath: string;
  repository?: string;
  branch?: string;
  initialPrompt: string;
  metadata?: Record<string, unknown>;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.cursorSession.create({
    data: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      projectId: input.projectId,
      projectPath: input.projectPath,
      repository: input.repository,
      branch: input.branch,
      status: "PENDING",
      initialPrompt: redactSecrets(input.initialPrompt).slice(0, 8000),
      iterations: JSON.stringify([]),
      metadata: input.metadata ? JSON.stringify(redactUnknown(input.metadata)) : null,
    },
  });
}

export async function updateCursorSession(input: {
  organizationId: string;
  id: string;
  status?: CursorSessionStatus;
  cursorSessionId?: string | null;
  lastResult?: unknown;
  iterations?: CodingIteration[];
  metadata?: Record<string, unknown>;
  repository?: string;
  branch?: string;
}) {
  assertOrganizationId(input.organizationId);
  return prisma.cursorSession.updateMany({
    where: { id: input.id, organizationId: input.organizationId },
    data: {
      status: input.status,
      cursorSessionId: input.cursorSessionId === undefined ? undefined : input.cursorSessionId,
      lastResult: input.lastResult === undefined ? undefined : JSON.stringify(redactUnknown(input.lastResult)),
      iterations: input.iterations ? JSON.stringify(redactUnknown(input.iterations)) : undefined,
      metadata: input.metadata ? JSON.stringify(redactUnknown(input.metadata)) : undefined,
      repository: input.repository,
      branch: input.branch,
    },
  });
}

export async function getCursorSession(organizationId: string, id: string) {
  assertOrganizationId(organizationId);
  return prisma.cursorSession.findFirst({ where: { id, organizationId } });
}

export function parseIterations(raw: string | null | undefined): CodingIteration[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CodingIteration[]) : [];
  } catch {
    return [];
  }
}

export async function cancelCodingSessions(organizationId: string): Promise<number> {
  assertOrganizationId(organizationId);
  noteCodingCancel(organizationId);
  const result = await prisma.cursorSession.updateMany({
    where: {
      organizationId,
      status: { in: ACTIVE_STATUSES },
    },
    data: {
      status: "CANCELLED_BY_USER",
      lastResult: JSON.stringify({ cancelled: true, keepChanges: true }),
    },
  });
  return result.count;
}

export async function hasCodingCancel(organizationId: string, sessionId?: string): Promise<boolean> {
  if (cancelWaiters.has(organizationId)) return true;
  if (!sessionId) return false;
  const session = await prisma.cursorSession.findFirst({
    where: { id: sessionId, organizationId },
    select: { status: true },
  });
  return session?.status === "CANCELLED_BY_USER" || session?.status === "CANCELLED";
}
