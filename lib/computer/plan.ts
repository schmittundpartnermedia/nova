import type { PlannedStep } from "@/agents/computer/planner";

export type ComputerPlan = {
  steps: PlannedStep[];
  cursor: number;
};

export function serializeComputerPlan(plan: ComputerPlan): ComputerPlan {
  return {
    steps: plan.steps,
    cursor: Math.max(0, Math.min(plan.cursor, plan.steps.length)),
  };
}

export function parseComputerPlan(raw: string | null | undefined): ComputerPlan | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return { steps: parsed as PlannedStep[], cursor: 0 };
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as ComputerPlan).steps)) {
      const plan = parsed as ComputerPlan;
      return { steps: plan.steps, cursor: Number(plan.cursor) || 0 };
    }
  } catch {
    return null;
  }
  return null;
}

export function remainingSteps(plan: ComputerPlan): PlannedStep[] {
  return plan.steps.slice(plan.cursor);
}

export const RESUMABLE_COMPUTER_STATUSES = ["INTERRUPTED", "FAILED", "WAITING_FOR_HUMAN"] as const;
