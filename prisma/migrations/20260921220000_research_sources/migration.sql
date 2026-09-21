-- AlterTable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "type" TEXT NOT NULL,
    "reference" TEXT,
    "url" TEXT,
    "canonical_url" TEXT,
    "title" TEXT,
    "domain" TEXT,
    "published_at" DATETIME,
    "retrieved_at" DATETIME,
    "provider" TEXT,
    "excerpt" TEXT,
    "trust_tier" TEXT,
    "trust_score" INTEGER,
    "metadata" TEXT,
    "label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sources_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_sources" ("created_at", "id", "label", "organization_id", "reference", "type", "url")
SELECT "created_at", "id", "label", "organization_id", "reference", "type", "url" FROM "sources";
DROP TABLE "sources";
ALTER TABLE "new_sources" RENAME TO "sources";
CREATE INDEX "sources_organization_id_idx" ON "sources"("organization_id");
CREATE INDEX "sources_organization_id_job_id_idx" ON "sources"("organization_id", "job_id");
CREATE INDEX "sources_organization_id_url_idx" ON "sources"("organization_id", "url");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
