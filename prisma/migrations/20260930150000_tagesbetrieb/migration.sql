-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "firma" TEXT NOT NULL,
    "ansprechpartner" TEXT,
    "anrede" TEXT NOT NULL,
    "email" TEXT,
    "telefon" TEXT,
    "ort" TEXT,
    "branche" TEXT,
    "website" TEXT,
    "befunde" TEXT,
    "aufhaenger" TEXT,
    "score" INTEGER,
    "quelle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'neu',
    "grund" TEXT,
    "geprueft_at" DATETIME,
    "campaign_id" TEXT,
    "entwurf_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_campaigns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vorlage" TEXT NOT NULL,
    "liste" TEXT NOT NULL,
    "absender" TEXT NOT NULL,
    "abstand_minuten" INTEGER NOT NULL,
    "art" TEXT NOT NULL DEFAULT 'kampagne',
    "status" TEXT NOT NULL DEFAULT 'wartet_auf_freigabe',
    "approval_id" TEXT,
    "ungueltig" TEXT NOT NULL DEFAULT '[]',
    "started_at" DATETIME,
    "finished_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_campaigns" ("absender", "abstand_minuten", "approval_id", "created_at", "finished_at", "id", "liste", "name", "organization_id", "started_at", "status", "ungueltig", "updated_at", "vorlage") SELECT "absender", "abstand_minuten", "approval_id", "created_at", "finished_at", "id", "liste", "name", "organization_id", "started_at", "status", "ungueltig", "updated_at", "vorlage" FROM "campaigns";
DROP TABLE "campaigns";
ALTER TABLE "new_campaigns" RENAME TO "campaigns";
CREATE INDEX "campaigns_organization_id_status_idx" ON "campaigns"("organization_id", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "leads_organization_id_status_idx" ON "leads"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_organization_id_email_key" ON "leads"("organization_id", "email");

