-- CreateTable
CREATE TABLE "project_contexts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "local_path" TEXT,
    "repository" TEXT,
    "branch" TEXT,
    "framework" TEXT,
    "architecture" TEXT,
    "rules" TEXT,
    "decisions" TEXT,
    "open_items" TEXT,
    "last_changes" TEXT,
    "last_analyzed_at" DATETIME,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "project_contexts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_contexts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cursor_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "project_id" TEXT,
    "project_path" TEXT NOT NULL,
    "repository" TEXT,
    "branch" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "cursor_session_id" TEXT,
    "initial_prompt" TEXT NOT NULL,
    "iterations" TEXT,
    "last_result" TEXT,
    "metadata" TEXT,
    CONSTRAINT "cursor_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cursor_sessions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "cursor_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "project_contexts_project_id_key" ON "project_contexts"("project_id");

-- CreateIndex
CREATE INDEX "project_contexts_organization_id_idx" ON "project_contexts"("organization_id");

-- CreateIndex
CREATE INDEX "cursor_sessions_organization_id_status_idx" ON "cursor_sessions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "cursor_sessions_organization_id_job_id_idx" ON "cursor_sessions"("organization_id", "job_id");
