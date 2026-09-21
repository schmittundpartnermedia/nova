-- CreateTable
CREATE TABLE "computer_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "goal" TEXT NOT NULL,
    "user_request" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT,
    "result" TEXT,
    "error" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    CONSTRAINT "computer_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "computer_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "computer_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "step_id" TEXT,
    "tool" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "risk_level" TEXT NOT NULL,
    "approval_id" TEXT,
    "status" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    "verification" TEXT,
    "error" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "computer_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "computer_actions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "computer_jobs_organization_id_status_idx" ON "computer_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "computer_jobs_organization_id_started_at_idx" ON "computer_jobs"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "computer_actions_organization_id_started_at_idx" ON "computer_actions"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "computer_actions_organization_id_job_id_idx" ON "computer_actions"("organization_id", "job_id");
