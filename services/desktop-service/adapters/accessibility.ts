import os from "node:os";
import { invokeNativeHelper, ensureNativeHelper } from "@/lib/computer/capabilities";
import { classifyComputerAction } from "@/lib/computer/risk";
import { createActionResult, failedResult } from "@/lib/computer/result";
import type { AccessibilityAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

export async function executeAccessibilityAction(input: {
  payload: AccessibilityAction;
  userCommissioned?: boolean;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const risk = classifyComputerAction({
    tool: "accessibility",
    action: input.payload.action,
    target: "identifier" in input.payload ? input.payload.identifier : input.payload.app,
    userCommissioned: input.userCommissioned,
  });
  if (os.platform() !== "darwin") {
    return failedResult({
      tool: "accessibility",
      action: input.payload.action,
      startedAt,
      riskLevel: "READ_ONLY",
      code: "unavailable",
      message: "Accessibility ist nur auf macOS verfügbar.",
    });
  }

  if (risk.approvalRequired && !input.userCommissioned) {
    return failedResult({
      tool: "accessibility",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: "UI-Steuerung braucht einen klaren Auftrag von dir.",
      approvalRequired: true,
    });
  }

  const helperBuild = await ensureNativeHelper();
  if (!helperBuild.ok) {
    return failedResult({
      tool: "accessibility",
      action: input.payload.action,
      startedAt,
      riskLevel: "READ_ONLY",
      code: "helper_missing",
      message: helperBuild.reason,
      metadata: { status: "NOT_IMPLEMENTED" },
    });
  }

  const cmd =
    input.payload.action === "inspect"
      ? "ax.inspect"
      : `ax.${input.payload.action}`;
  const helper = await invokeNativeHelper({
    cmd,
    app: "app" in input.payload ? input.payload.app : undefined,
    identifier: "identifier" in input.payload ? input.payload.identifier : undefined,
    value: "value" in input.payload ? input.payload.value : undefined,
    maxDepth: "maxDepth" in input.payload ? input.payload.maxDepth : 3,
  });

  if (helper.permission === "accessibility" || helper.error === "PERMISSION_REQUIRED") {
    return failedResult({
      tool: "accessibility",
      action: input.payload.action,
      startedAt,
      riskLevel: "READ_ONLY",
      code: "permission_required",
      message: "NOVA benötigt Bedienungshilfen-Zugriff.",
      metadata: { status: "PERMISSION_REQUIRED", permission: "accessibility" },
    });
  }

  if (!helper.ok) {
    const code = helper.error ?? "ax_error";
    const message =
      code === "ax_not_found"
        ? "Das UI-Element wurde nicht gefunden."
        : code === "missing_identifier"
          ? "Ohne Bezeichnung kann ich nichts anklicken."
          : code === "PERMISSION_REQUIRED"
            ? "NOVA benötigt Bedienungshilfen-Zugriff."
            : "Accessibility-Aktion fehlgeschlagen.";
    return failedResult({
      tool: "accessibility",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code,
      message,
      metadata: { status: "ERROR", identifier: "identifier" in input.payload ? input.payload.identifier : undefined },
    });
  }

  return createActionResult({
    tool: "accessibility",
    action: input.payload.action,
    startedAt,
    success: true,
    riskLevel: risk.risk,
    approvalRequired: false,
    result: helper.data ?? helper,
    verification: { verified: true, method: "native_helper" },
  });
}
