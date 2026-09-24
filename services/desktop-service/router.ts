import {
  accessibilityActionSchema,
  applicationActionSchema,
  browserActionSchema,
  computerActionEnvelopeSchema,
  cursorActionSchema,
  filesystemActionSchema,
  processActionSchema,
  screenActionSchema,
  shellActionSchema,
  type ComputerActionEnvelope,
} from "@/lib/computer/schemas";
import { isInjectionAttempt } from "@/lib/computer/injection";
import { detectHardBlock } from "@/lib/computer/hard-blocks";
import { executeFilesystemAction } from "@/services/desktop-service/adapters/filesystem";
import { executeShellAction } from "@/services/desktop-service/adapters/shell";
import { executeProcessAction } from "@/services/desktop-service/adapters/process";
import { executeCursorAction } from "@/services/desktop-service/adapters/cursor";
import { executeBrowserAction } from "@/services/desktop-service/adapters/browser";
import { executeApplicationAction } from "@/services/desktop-service/adapters/application";
import { executeAccessibilityAction } from "@/services/desktop-service/adapters/accessibility";
import { executeScreenAction } from "@/services/desktop-service/adapters/screen";
import { failedResult } from "@/lib/computer/result";
import type { ActionResult } from "@/lib/computer/types";

export async function routeDesktopAction(input: {
  envelope: unknown;
  userCommissioned: boolean;
  signal?: AbortSignal;
}): Promise<ActionResult> {
  const startedAt = new Date();
  const parsed = computerActionEnvelopeSchema.safeParse(input.envelope);
  if (!parsed.success) {
    return failedResult({
      tool: "computer",
      action: "validate",
      startedAt,
      riskLevel: "SYSTEM_CHANGE",
      code: "invalid_schema",
      message: "Tool-Request entsprach nicht dem Schema.",
      metadata: { issues: parsed.error.issues.map((issue) => issue.message) },
    });
  }

  const envelope = parsed.data;
  if (envelope.source === "external_content") {
    const blob = JSON.stringify(envelope.payload);
    if (isInjectionAttempt(blob) || detectHardBlock(blob)) {
      return failedResult({
        tool: envelope.tool,
        action: "blocked",
        startedAt,
        riskLevel: "DESTRUCTIVE",
        code: "untrusted_content",
        message: "Externer Inhalt wurde als untrusted behandelt und nicht ausgeführt.",
        approvalRequired: true,
      });
    }
  }

  return dispatch(envelope, input.userCommissioned, input.signal);
}

async function dispatch(envelope: ComputerActionEnvelope, userCommissioned: boolean, signal?: AbortSignal): Promise<ActionResult> {
  const startedAt = new Date();
  switch (envelope.tool) {
    case "filesystem": {
      const payload = filesystemActionSchema.parse(envelope.payload);
      return executeFilesystemAction({ payload, userCommissioned, approvalToken: envelope.approvalToken });
    }
    case "shell": {
      const payload = shellActionSchema.parse(envelope.payload);
      return executeShellAction({ payload, userCommissioned, approvalToken: envelope.approvalToken, signal });
    }
    case "process": {
      const payload = processActionSchema.parse(envelope.payload);
      return executeProcessAction({ payload, userCommissioned, approvalToken: envelope.approvalToken, signal });
    }
    case "cursor": {
      const payload = cursorActionSchema.parse(envelope.payload);
      return executeCursorAction({
        payload,
        userCommissioned,
        approvalToken: envelope.approvalToken,
        signal,
        timeoutMs: envelope.timeoutMs,
      });
    }
    case "browser": {
      const payload = browserActionSchema.parse(envelope.payload);
      return executeBrowserAction({ payload, userCommissioned, approvalToken: envelope.approvalToken, signal });
    }
    case "application": {
      const payload = applicationActionSchema.parse(envelope.payload);
      return executeApplicationAction({ payload, userCommissioned, approvalToken: envelope.approvalToken });
    }
    case "accessibility": {
      const payload = accessibilityActionSchema.parse(envelope.payload);
      return executeAccessibilityAction({ payload, userCommissioned });
    }
    case "screen": {
      const payload = screenActionSchema.parse(envelope.payload);
      return executeScreenAction({ payload });
    }
    default:
      return failedResult({
        tool: "computer",
        action: "route",
        startedAt,
        riskLevel: "SYSTEM_CHANGE",
        code: "unknown_tool",
        message: "Unbekanntes Tool.",
      });
  }
}
