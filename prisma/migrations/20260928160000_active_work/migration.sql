-- ActiveWork: universelles Arbeitsgedächtnis für Auftragsketten
CREATE TABLE "active_works" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "domain" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "slots" TEXT NOT NULL DEFAULT '{}',
    "missing_slots" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'clarifying',
    "last_question" TEXT,
    "evidence" TEXT,
    "linked_ids" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    CONSTRAINT "active_works_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "active_works_organization_id_status_idx" ON "active_works"("organization_id", "status");
CREATE INDEX "active_works_organization_id_conversation_id_idx" ON "active_works"("organization_id", "conversation_id");
