export type OrbState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "WORKING"
  | "SPEAKING"
  | "WAITING_FOR_APPROVAL"
  | "DONE"
  | "ERROR";

export type JobStatus =
  | "pending"
  | "planning"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type JobStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type ActivityStatus = "suggested" | "prepared" | "executed" | "failed";

export type ActivityType =
  | "research"
  | "communication"
  | "meeting"
  | "task"
  | "document"
  | "calendar"
  | "job"
  | "memory"
  | "approval"
  | "conversation"
  | "decision"
  | "project_activity"
  | "execution"
  | "computer"
  | "coding"
  | "knowledge";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type MemberRole = "owner" | "admin" | "member";

export type SourceType =
  | "chatgpt"
  | "nova"
  | "email"
  | "meeting"
  | "document"
  | "manual"
  | "research"
  | "calendar"
  | "conversation_message";

export type MemoryType =
  | "person"
  | "company"
  | "project"
  | "decision"
  | "preference"
  | "summary"
  | "fact"
  | "conversation_insight"
  | "research"
  | "communication"
  | "task";

export type RelationType =
  | "works_at"
  | "belongs_to"
  | "contacted"
  | "replied"
  | "meeting"
  | "memo"
  | "offer_requested"
  | "follow_up"
  | "related"
  | "candidate_for"
  | "drafted_for"
  | "founder_of"
  | "product_of"
  | "mentions"
  | "has_deadline"
  | "relates_to"
  | "version_of"
  | "contradicts"
  | "attached_to"
  | "considered_as_partner_for"
  | "used_by"
  | "supersedes";

export type RiskLevel = "low" | "medium" | "high";

export type TenantContext = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  userId: string;
  userName: string;
  role: MemberRole;
};
