import os from "node:os";
import { invokeNativeHelper, ensureNativeHelper } from "@/lib/computer/capabilities";
import { classifyComputerAction } from "@/lib/computer/risk";
import { createActionResult, failedResult } from "@/lib/computer/result";
import { runArgv } from "@/services/desktop-service/adapters/shell";
import { compileAppleScript } from "@/lib/computer/applescript";
import type { ApplicationAction } from "@/lib/computer/schemas";
import type { ActionResult } from "@/lib/computer/types";

export async function executeApplicationAction(input: {
  payload: ApplicationAction;
  userCommissioned: boolean;
  approvalToken?: string;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const risk = classifyComputerAction({
    tool: "application",
    action: input.payload.action,
    target: "name" in input.payload ? input.payload.name : undefined,
    userCommissioned: input.userCommissioned,
  });

  if (os.platform() !== "darwin") {
    return failedResult({
      tool: "application",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "unavailable",
      message: "Application Control ist nur auf macOS verfügbar.",
    });
  }

  if (risk.approvalRequired && !input.approvalToken) {
    return failedResult({
      tool: "application",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "approval_required",
      message: risk.reason,
      approvalRequired: true,
    });
  }

  await ensureNativeHelper();

  try {
    switch (input.payload.action) {
      case "listInstalled":
      case "listRunning":
      case "windows": {
        const helper = await invokeNativeHelper({
          cmd: input.payload.action === "windows" ? "windows" : "apps",
        });
        return createActionResult({
          tool: "application",
          action: input.payload.action,
          startedAt,
          success: helper.ok,
          riskLevel: "READ_ONLY",
          approvalRequired: false,
          result: helper.data ?? { error: helper.error },
          verification: { verified: helper.ok, method: "native_helper" },
        });
      }
      case "launch":
      case "focus": {
        const name = input.payload.name;
        const helper = await invokeNativeHelper({ cmd: `app.${input.payload.action}`, app: name });
        if (!helper.ok) {
          const fallback = await runArgv({
            argv: ["open", "-a", name],
            cwd: process.cwd(),
            timeoutMs: 8000,
          });
          return createActionResult({
            tool: "application",
            action: input.payload.action,
            startedAt,
            success: fallback.code === 0,
            riskLevel: "READ_ONLY",
            approvalRequired: false,
            target: name,
            result: { via: "open -a", code: fallback.code, stderr: fallback.stderr.slice(0, 400) },
            verification: { verified: fallback.code === 0, method: "open -a" },
          });
        }
        return createActionResult({
          tool: "application",
          action: input.payload.action,
          startedAt,
          success: true,
          riskLevel: "READ_ONLY",
          approvalRequired: false,
          target: name,
          result: helper.data ?? { ok: true },
          verification: { verified: true, method: "native_helper" },
        });
      }
      case "quit": {
        const helper = await invokeNativeHelper({ cmd: "app.quit", app: input.payload.name });
        return createActionResult({
          tool: "application",
          action: "quit",
          startedAt,
          success: helper.ok,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: input.payload.name,
          result: helper,
          verification: { verified: helper.ok, method: "native_helper" },
        });
      }
      case "runScript": {
        const compiled = compileAppleScript(input.payload.source);
        if (!compiled.ok) {
          return failedResult({
            tool: "application",
            action: "runScript",
            startedAt,
            riskLevel: risk.risk,
            code: "applescript_rejected",
            message: compiled.reason,
          });
        }
        const helper = await invokeNativeHelper(
          { cmd: "applescript.run", script: compiled.source, app: compiled.app, value: compiled.source },
          20_000,
        );
        if (helper.permission === "automation" || helper.error === "PERMISSION_REQUIRED") {
          return failedResult({
            tool: "application",
            action: "runScript",
            startedAt,
            riskLevel: "SYSTEM_CHANGE",
            code: "permission_required",
            message: "NOVA benötigt Automation-Zugriff für AppleScript.",
            metadata: { status: "PERMISSION_REQUIRED", permission: "automation" },
          });
        }
        if (!helper.ok) {
          return failedResult({
            tool: "application",
            action: "runScript",
            startedAt,
            riskLevel: risk.risk,
            code: helper.error ?? "applescript_failed",
            message: typeof helper.error === "string" && helper.error
              ? helper.error
              : "AppleScript ist fehlgeschlagen.",
            metadata: { app: compiled.app },
          });
        }
        return createActionResult({
          tool: "application",
          action: "runScript",
          startedAt,
          success: true,
          riskLevel: risk.risk,
          approvalRequired: false,
          target: compiled.app,
          result: helper.data ?? helper,
          verification: { verified: true, method: "native_helper" },
        });
      }
    }
  } catch (error) {
    return failedResult({
      tool: "application",
      action: input.payload.action,
      startedAt,
      riskLevel: risk.risk,
      code: "application_error",
      message: error instanceof Error ? error.message : "Application Adapter Fehler",
    });
  }
}
