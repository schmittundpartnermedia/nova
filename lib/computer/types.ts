export const CAPABILITY_IDS = [
  "browser.playwright",
  "browser.open",
  "browser.navigate",
  "browser.read",
  "browser.inspect",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.check",
  "browser.scroll",
  "browser.tabs",
  "browser.screenshot",
  "browser.upload",
  "browser.download",
  "browser.back",
  "browser.forward",
  "browser.reload",
  "screen.capture",
  "screen.inspect",
  "macos.accessibility",
  "macos.app.launch",
  "macos.app.focus",
  "macos.app.quit",
  "macos.ui.inspect",
  "macos.ui.click",
  "macos.ui.type",
  "macos.ui.select",
  "filesystem.read",
  "filesystem.search",
  "filesystem.write",
  "filesystem.move",
  "filesystem.copy",
  "filesystem.create",
  "filesystem.delete",
  "shell.execute",
  "process.list",
  "process.inspect",
  "process.start",
  "process.stop",
  "cursor.available",
  "cursor.ask",
  "cursor.plan",
  "cursor.agent",
  "cursor.status",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type CapabilityStatus =
  | "AVAILABLE"
  | "PERMISSION_REQUIRED"
  | "UNAVAILABLE"
  | "ERROR"
  | "NOT_IMPLEMENTED";

export type MacPermissionId =
  | "accessibility"
  | "screen_recording"
  | "automation"
  | "microphone"
  | "files_folders";

export type CapabilityRecord = {
  id: CapabilityId;
  status: CapabilityStatus;
  reason?: string;
  permission?: MacPermissionId;
};

export type ComputerRiskClass =
  | "READ_ONLY"
  | "WORKSPACE_WRITE"
  | "SYSTEM_CHANGE"
  | "DESTRUCTIVE"
  | "PRIVILEGED"
  | "EXTERNAL_SIDE_EFFECT";

export type ApprovalClass = "A" | "B" | "C";

export type ComputerJobStatus =
  | "PLANNED"
  | "PREPARED"
  | "EXECUTING"
  | "WAITING_FOR_APPROVAL"
  | "EXECUTED"
  | "VERIFIED"
  | "FAILED"
  | "CANCELLED"
  | "CANCELLED_BY_USER";

export type ContentSource = "user_intent" | "nova_plan" | "external_content";

export type ToolName =
  | "browser"
  | "filesystem"
  | "shell"
  | "cursor"
  | "application"
  | "process"
  | "screen"
  | "accessibility"
  | "computer";

export type VerificationResult = {
  verified: boolean;
  method: string;
  details?: string;
};

export type ArtifactRef = {
  kind: "screenshot" | "log" | "file" | "text";
  path?: string;
  ephemeral: boolean;
  description: string;
};

export type ActionError = {
  code: string;
  message: string;
};

export type ActionResult = {
  success: boolean;
  tool: ToolName;
  action: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  target?: string;
  result?: unknown;
  verification?: VerificationResult;
  artifacts?: ArtifactRef[];
  error?: ActionError;
  riskLevel: ComputerRiskClass;
  approvalRequired: boolean;
  metadata?: Record<string, unknown>;
};

export type DesktopHealth = {
  ok: boolean;
  service: "nova-desktop";
  version: string;
  listen: string;
  pid: number;
  uptimeMs: number;
};

export type PermissionSnapshot = {
  id: MacPermissionId;
  status: CapabilityStatus;
  message: string;
};

export const DESKTOP_SERVICE_VERSION = "0.1.0";
