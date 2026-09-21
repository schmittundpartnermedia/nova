import os from "node:os";
import { invokeNativeHelper, ensureNativeHelper } from "@/lib/computer/capabilities";
import { createActionResult, failedResult } from "@/lib/computer/result";
import type { AccessibilityAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

export async function executeAccessibilityAction(input: {
  payload: AccessibilityAction;
}): Promise<ActionResult> {
  const startedAt = new Date();
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
    return failedResult({
      tool: "accessibility",
      action: input.payload.action,
      startedAt,
      riskLevel: "READ_ONLY",
      code: helper.error ?? "ax_error",
      message:
        helper.error === "ax_action_foundation"
          ? "Accessibility-Aktionen sind als Foundation vorbereitet, Element-Targeting ist noch nicht produktionsfähig."
          : helper.error ?? "Accessibility fehlgeschlagen.",
      metadata: { status: helper.error === "ax_action_foundation" ? "NOT_IMPLEMENTED" : "ERROR" },
    });
  }

  return createActionResult({
    tool: "accessibility",
    action: input.payload.action,
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    result: helper.data ?? helper,
    verification: { verified: true, method: "native_helper" },
  });
}
