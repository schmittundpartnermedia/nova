import { redactUnknown } from "@/lib/computer/redaction";
import type { ActionError, ActionResult, ComputerRiskClass, ToolName, VerificationResult } from "@/lib/computer/types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createActionResult(input: {
  tool: ToolName;
  action: string;
  startedAt: Date;
  success: boolean;
  riskLevel: ComputerRiskClass;
  approvalRequired: boolean;
  target?: string;
  result?: unknown;
  verification?: VerificationResult;
  artifacts?: ActionResult["artifacts"];
  error?: ActionError;
  metadata?: Record<string, unknown>;
}): ActionResult {
  const finishedAt = new Date();
  return {
    success: input.success,
    tool: input.tool,
    action: input.action,
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
    target: input.target,
    result: redactUnknown(input.result),
    verification: input.verification,
    artifacts: input.artifacts,
    error: input.error,
    riskLevel: input.riskLevel,
    approvalRequired: input.approvalRequired,
    metadata: input.metadata ? (redactUnknown(input.metadata) as Record<string, unknown>) : undefined,
  };
}

export function failedResult(input: {
  tool: ToolName;
  action: string;
  startedAt: Date;
  riskLevel: ComputerRiskClass;
  code: string;
  message: string;
  approvalRequired?: boolean;
  target?: string;
  metadata?: Record<string, unknown>;
}): ActionResult {
  return createActionResult({
    tool: input.tool,
    action: input.action,
    startedAt: input.startedAt,
    success: false,
    riskLevel: input.riskLevel,
    approvalRequired: Boolean(input.approvalRequired),
    target: input.target,
    error: { code: input.code, message: input.message },
    verification: { verified: false, method: "error", details: input.message },
    metadata: input.metadata,
  });
}
