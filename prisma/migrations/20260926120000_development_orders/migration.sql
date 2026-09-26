CREATE TABLE "development_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "user_request" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "desired_behavior" TEXT NOT NULL,
    "existing_capabilities" TEXT NOT NULL,
    "gap" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "approval_rules" TEXT NOT NULL,
    "acceptance" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "iteration" INTEGER NOT NULL DEFAULT 0,
    "max_iterations" INTEGER NOT NULL DEFAULT 2,
    "history" TEXT NOT NULL DEFAULT '[]',
    "result_summary" TEXT,
    "cursor_session_id" TEXT,
    "workspace_path" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "development_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "development_orders_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "development_orders_organization_id_status_idx" ON "development_orders"("organization_id", "status");
