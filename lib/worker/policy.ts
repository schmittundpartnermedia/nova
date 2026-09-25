export type EffectDecision = "proceed" | "already_committed" | "needs_verification";

export function backoffMs(attempt: number, baseMs = 1_000, capMs = 15 * 60_000): number {
  const step = Math.max(0, attempt - 1);
  const value = baseMs * 2 ** step;
  return Math.min(capMs, value);
}

export function decideExternalEffect(existing: { status: string } | null): EffectDecision {
  if (!existing) return "proceed";
  if (existing.status === "committed") return "already_committed";
  return "needs_verification";
}

export function nextRunAt(now: Date, attempt: number): Date {
  return new Date(now.getTime() + backoffMs(attempt));
}
