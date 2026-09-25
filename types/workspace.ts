export const ARTIFACT_TYPES = [
  "RESEARCH_REPORT",
  "BRIEFING",
  "ANALYSIS",
  "STORYBOARD",
  "LEAD_LIST",
  "MAIL_DRAFT",
  "CODING_BRIEF",
  "DOCUMENT",
  "VIDEO_CLIP",
  "IMAGE",
  "AUDIO",
  "EXPORT",
  "OTHER",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUPERSEDED",
  "FINAL",
] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const REVIEW_TYPES = [
  "DOCUMENT",
  "MAIL_DRAFT",
  "WEB_RESULT",
  "WEBSITE",
  "VIDEO",
  "IMAGE",
  "AUDIO",
  "FILE",
  "CODING_RESULT",
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_STATUSES = [
  "PREPARED",
  "OPENING",
  "AWAITING_REVIEW",
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
  "CANCELLED",
  "FAILED",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const WORKSPACE_AVAILABILITY = ["AVAILABLE", "UNAVAILABLE", "READ_ONLY", "ERROR"] as const;

export type WorkspaceAvailability = (typeof WORKSPACE_AVAILABILITY)[number];

export type WorkspaceRootStatus = {
  availability: WorkspaceAvailability;
  configuredPath: string | null;
  resolvedPath: string | null;
  volumeName: string | null;
  source: "env" | "volume" | "none";
  writable: boolean;
  message: string;
};

export const ACTIVE_REVIEW_STATUSES: ReviewStatus[] = ["PREPARED", "OPENING", "AWAITING_REVIEW", "FAILED"];
