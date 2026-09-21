export const CURSOR_SESSION_STATUSES = [
  "PENDING",
  "STARTING",
  "RUNNING",
  "WAITING",
  "VERIFYING",
  "NEEDS_FIX",
  "WAITING_FOR_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "CANCELLED_BY_USER",
] as const;

export type CursorSessionStatus = (typeof CURSOR_SESSION_STATUSES)[number];

export type CodingIntentKind =
  | "cancel"
  | "website_build"
  | "implement"
  | "fix"
  | "none";

export type CodingIntent = {
  kind: CodingIntentKind;
  userCommissioned: boolean;
  statusMessage: string;
  projectHint?: string;
};

export type VerificationCheckStatus = "passed" | "failed" | "skipped" | "unverified";

export type VerificationCheck = {
  id: string;
  label: string;
  status: VerificationCheckStatus;
  details: string;
};

export type CodingIteration = {
  index: number;
  phase: string;
  prompt: string;
  cursorSessionId?: string;
  resultSummary: string;
  checks?: VerificationCheck[];
};

export type CodingWorkflowKind = "website" | "software";
