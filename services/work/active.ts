import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import {
  missingRequiredSlots,
  nextSlotQuestion,
  type ActiveWorkDomain,
  type ActiveWorkStatus,
} from "@/lib/work/slots";

export type ActiveWorkRecord = {
  id: string;
  organizationId: string;
  conversationId: string | null;
  domain: ActiveWorkDomain;
  goal: string;
  brief: string;
  slots: Record<string, string>;
  missingSlots: string[];
  status: ActiveWorkStatus;
  lastQuestion: string | null;
  evidence: string | null;
  linkedIds: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

const OPEN: ActiveWorkStatus[] = ["clarifying", "ready", "executing", "waiting_approval", "verifying"];

function decode(row: {
  id: string;
  organizationId: string;
  conversationId: string | null;
  domain: string;
  goal: string;
  brief: string;
  slots: string;
  missingSlots: string;
  status: string;
  lastQuestion: string | null;
  evidence: string | null;
  linkedIds: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}): ActiveWorkRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    conversationId: row.conversationId,
    domain: row.domain as ActiveWorkDomain,
    goal: row.goal,
    brief: row.brief,
    slots: safeObject(row.slots),
    missingSlots: safeArray(row.missingSlots),
    status: row.status as ActiveWorkStatus,
    lastQuestion: row.lastQuestion,
    evidence: row.evidence,
    linkedIds: safeObject(row.linkedIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function safeObject(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" && item.trim()) out[key] = item.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function safeArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function loadOpenActiveWork(input: {
  organizationId: string;
  conversationId?: string;
}): Promise<ActiveWorkRecord | null> {
  assertOrganizationId(input.organizationId);
  const row = await prisma.activeWork.findFirst({
    where: {
      organizationId: input.organizationId,
      status: { in: OPEN },
      ...(input.conversationId ? { OR: [{ conversationId: input.conversationId }, { conversationId: null }] } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return row ? decode(row) : null;
}

export async function createActiveWork(input: {
  organizationId: string;
  conversationId?: string;
  domain: ActiveWorkDomain;
  goal: string;
  brief: string;
  slots?: Record<string, string>;
}): Promise<ActiveWorkRecord> {
  assertOrganizationId(input.organizationId);
  await cancelOpenActiveWorks(input.organizationId, "Neuer Auftrag ersetzt den vorherigen offenen Auftrag.");
  const slots = input.slots ?? {};
  const missing = missingRequiredSlots(input.domain, slots);
  const status: ActiveWorkStatus = missing.length ? "clarifying" : "ready";
  const question = nextSlotQuestion(input.domain, missing);
  const row = await prisma.activeWork.create({
    data: {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      domain: input.domain,
      goal: input.goal,
      brief: input.brief,
      slots: JSON.stringify(slots),
      missingSlots: JSON.stringify(missing),
      status,
      lastQuestion: question,
    },
  });
  return decode(row);
}

export async function updateActiveWorkSlots(input: {
  organizationId: string;
  workId: string;
  slots: Record<string, string>;
  brief?: string;
}): Promise<ActiveWorkRecord> {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.activeWork.findFirst({
    where: { id: input.workId, organizationId: input.organizationId },
  });
  if (!existing) throw new Error("ActiveWork nicht gefunden.");
  const current = decode(existing);
  const slots = { ...current.slots, ...input.slots };
  const missing = missingRequiredSlots(current.domain, slots);
  const status: ActiveWorkStatus = missing.length ? "clarifying" : current.status === "clarifying" ? "ready" : current.status;
  const row = await prisma.activeWork.update({
    where: { id: existing.id },
    data: {
      slots: JSON.stringify(slots),
      missingSlots: JSON.stringify(missing),
      status,
      lastQuestion: nextSlotQuestion(current.domain, missing),
      brief: input.brief ?? current.brief,
    },
  });
  return decode(row);
}

export async function setActiveWorkStatus(input: {
  organizationId: string;
  workId: string;
  status: ActiveWorkStatus;
  evidence?: string | null;
  linkedIds?: Record<string, string>;
  lastQuestion?: string | null;
}): Promise<ActiveWorkRecord> {
  assertOrganizationId(input.organizationId);
  const existing = await prisma.activeWork.findFirst({
    where: { id: input.workId, organizationId: input.organizationId },
  });
  if (!existing) throw new Error("ActiveWork nicht gefunden.");
  const linked = { ...safeObject(existing.linkedIds), ...(input.linkedIds ?? {}) };
  const done = input.status === "done" || input.status === "failed" || input.status === "cancelled";
  const row = await prisma.activeWork.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      evidence: input.evidence === undefined ? existing.evidence : input.evidence,
      linkedIds: JSON.stringify(linked),
      lastQuestion: input.lastQuestion === undefined ? existing.lastQuestion : input.lastQuestion,
      completedAt: done ? new Date() : null,
    },
  });
  return decode(row);
}

export async function cancelOpenActiveWorks(organizationId: string, evidence?: string) {
  assertOrganizationId(organizationId);
  await prisma.activeWork.updateMany({
    where: { organizationId, status: { in: OPEN } },
    data: {
      status: "cancelled",
      evidence: evidence ?? "Auftrag abgebrochen.",
      completedAt: new Date(),
    },
  });
}

export function summarizeActiveWork(work: ActiveWorkRecord): string {
  const slotLines = Object.entries(work.slots)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  return `${work.domain}: ${work.goal}${slotLines ? ` (${slotLines})` : ""}`;
}
