import os from "node:os";
import { invokeNativeHelper, ensureNativeHelper } from "@/lib/computer/capabilities";
import { createActionResult, failedResult } from "@/lib/computer/result";
import type { ScreenAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

export async function executeScreenAction(input: { payload: ScreenAction }): Promise<ActionResult> {
  const startedAt = new Date();
  if (os.platform() !== "darwin") {
    return failedResult({
      tool: "screen",
      action: input.payload.action,
      startedAt,
      riskLevel: "READ_ONLY",
      code: "unavailable",
      message: "Screen Capture ist nur auf macOS verfügbar.",
    });
  }

  const helperBuild = await ensureNativeHelper();
  if (!helperBuild.ok) {
    return failedResult({
      tool: "screen",
      action: input.payload.action,
      startedAt,
      riskLevel: "READ_ONLY",
      code: "helper_missing",
      message: helperBuild.reason,
      metadata: { status: "NOT_IMPLEMENTED" },
    });
  }

  if (input.payload.action === "inspect") {
    const helper = await invokeNativeHelper({ cmd: "windows" });
    return createActionResult({
      tool: "screen",
      action: "inspect",
      startedAt,
      success: helper.ok,
      riskLevel: "READ_ONLY",
      approvalRequired: false,
      result: helper.data ?? helper,
      verification: { verified: helper.ok, method: "cgwindowlist" },
    });
  }

  const helper = await invokeNativeHelper({ cmd: "capture", persist: false });
  if (helper.permission === "screen_recording" || helper.error === "PERMISSION_REQUIRED") {
    return failedResult({
      tool: "screen",
      action: "capture",
      startedAt,
      riskLevel: "READ_ONLY",
      code: "permission_required",
      message: "NOVA benötigt Bildschirmaufnahme-Zugriff.",
      metadata: { status: "PERMISSION_REQUIRED", permission: "screen_recording" },
    });
  }
  if (!helper.ok) {
    return failedResult({
      tool: "screen",
      action: "capture",
      startedAt,
      riskLevel: "READ_ONLY",
      code: helper.error ?? "capture_failed",
      message: helper.error ?? "Screen Capture fehlgeschlagen.",
      metadata: { status: "ERROR" },
    });
  }

  return createActionResult({
    tool: "screen",
    action: "capture",
    startedAt,
    success: true,
    riskLevel: "READ_ONLY",
    approvalRequired: false,
    result: { path: helper.path, ephemeral: true },
    artifacts: helper.path
      ? [{ kind: "screenshot", path: helper.path, ephemeral: true, description: "Ephemeral screen capture" }]
      : undefined,
    verification: { verified: true, method: "native_capture" },
    metadata: { persist: false, note: "Screenshot ist ephemer und wird nicht ins Memory übernommen." },
  });
}
