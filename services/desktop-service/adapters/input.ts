import os from "node:os";
import { invokeNativeHelper, ensureNativeHelper } from "@/lib/computer/capabilities";
import { classifyComputerAction } from "@/lib/computer/risk";
import { createActionResult, failedResult } from "@/lib/computer/result";
import type { InputAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

export async function executeInputAction(input: {
  payload: InputAction;
  userCommissioned: boolean;
  approvalToken?: string;
}): Promise<ActionResult> {
  const startedAt = new Date();
  if (os.platform() !== "darwin") {
    return failedResult({
      tool: "input",
      action: input.payload.action,
      startedAt,
      riskLevel: "SYSTEM_CHANGE",
      code: "unavailable",
      message: "Eingabe-Primitive sind nur auf macOS verfügbar.",
    });
  }

  const risk = classifyComputerAction({
    tool: "input",
    action: input.payload.action,
    userCommissioned: input.userCommissioned,
  });
  if (risk.approvalRequired && !input.approvalToken) {
    return failedResult({
      tool: "input",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
    });
  }

  const helperBuild = await ensureNativeHelper();
  if (!helperBuild.ok) {
    return failedResult({
      tool: "input",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "helper_missing",
      message: helperBuild.reason,
    });
  }

  const cmd =
    input.payload.action === "clipboardGet"
      ? "clipboard.get"
      : input.payload.action === "clipboardSet"
        ? "clipboard.set"
        : `input.${input.payload.action}`;

  const helper = await invokeNativeHelper({
    cmd,
    ...input.payload,
  });

  if (!helper.ok) {
    return failedResult({
      tool: "input",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: helper.error ?? "input_failed",
      message: helper.error ?? "Eingabeaktion fehlgeschlagen.",
    });
  }

  return createActionResult({
    tool: "input",
    action: input.payload.action,
    startedAt,
    success: true,
    riskLevel: risk.risk,
    approvalRequired: false,
    result: helper.data ?? helper,
    verification: { verified: true, method: "cgevent" },
  });
}
