-- Workspace, Artefakte, ReviewSessions und persistente Worker-Queue.
ALTER TABLE "jobs" ADD COLUMN "resume_state" TEXT;
ALTER TABLE "jobs" ADD COLUMN "scheduled_at" DATETIME;
ALTER TABLE "jobs" ADD COLUMN "pause_reason" TEXT;
ALTER TABLE "jobs" ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "jobs" ADD COLUMN "idempotency_key" TEXT;

CREATE TABLE "workspace_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "artifact_id" TEXT,
    "job_id" TEXT,
    "source" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "workspace_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "job_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storage_path" TEXT,
    "external_reference" TEXT,
    "mime_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "version_group_id" TEXT NOT NULL,
    "knowledge_source_id" TEXT,
    "memory_entry_id" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "artifacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "review_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "artifact_id" TEXT,
    "approval_request_id" TEXT,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "application" TEXT,
    "status" TEXT NOT NULL,
    "opened_at" DATETIME,
    "resolved_at" DATETIME,
    "resolution" TEXT,
    "resume_step" TEXT,
    "ownership" TEXT,
    "instruction" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "review_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_sessions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_sessions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "review_sessions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "work_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "run_at" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "idempotency_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "last_error" TEXT,
    "locked_by" TEXT,
    "locked_until" DATETIME,
    "completed_at" DATETIME,
    "external_effect" TEXT NOT NULL DEFAULT 'none',
    "audit" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "work_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "work_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "work_effects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "work_item_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "effect_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" DATETIME,
    CONSTRAINT "work_effects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "work_effects_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_entries_organization_id_relative_path_key" ON "workspace_entries"("organization_id", "relative_path");
CREATE INDEX "workspace_entries_organization_id_kind_idx" ON "workspace_entries"("organization_id", "kind");
CREATE INDEX "workspace_entries_organization_id_artifact_id_idx" ON "workspace_entries"("organization_id", "artifact_id");
CREATE INDEX "artifacts_organization_id_type_idx" ON "artifacts"("organization_id", "type");
CREATE INDEX "artifacts_organization_id_version_group_id_idx" ON "artifacts"("organization_id", "version_group_id");
CREATE INDEX "artifacts_organization_id_status_idx" ON "artifacts"("organization_id", "status");
CREATE INDEX "artifacts_job_id_idx" ON "artifacts"("job_id");
CREATE INDEX "review_sessions_organization_id_status_idx" ON "review_sessions"("organization_id", "status");
CREATE INDEX "review_sessions_job_id_idx" ON "review_sessions"("job_id");
CREATE UNIQUE INDEX "work_items_organization_id_idempotency_key_key" ON "work_items"("organization_id", "idempotency_key");
CREATE INDEX "work_items_organization_id_status_run_at_idx" ON "work_items"("organization_id", "status", "run_at");
CREATE INDEX "work_items_job_id_idx" ON "work_items"("job_id");
CREATE UNIQUE INDEX "work_effects_organization_id_idempotency_key_key" ON "work_effects"("organization_id", "idempotency_key");
CREATE INDEX "work_effects_work_item_id_idx" ON "work_effects"("work_item_id");
