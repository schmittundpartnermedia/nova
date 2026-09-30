-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vorlage" TEXT NOT NULL,
    "liste" TEXT NOT NULL,
    "absender" TEXT NOT NULL,
    "abstand_minuten" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'wartet_auf_freigabe',
    "approval_id" TEXT,
    "ungueltig" TEXT NOT NULL DEFAULT '[]',
    "started_at" DATETIME,
    "finished_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_communications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "external_reference" TEXT,
    "external_url" TEXT,
    "sent_at" DATETIME,
    "delivery_status" TEXT NOT NULL DEFAULT 'PREPARED',
    "mail_account_id" TEXT,
    "from_address" TEXT,
    "to_address" TEXT,
    "reply_ref" TEXT,
    "campaign_id" TEXT,
    "recipient_name" TEXT,
    "mail_thread_id" TEXT,
    "in_reply_to" TEXT,
    "references_header" TEXT,
    "template_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "communications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "communications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "communications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "communications_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "communications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "mail_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "communications_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_communications" ("body", "channel", "company_id", "contact_id", "created_at", "delivery_status", "direction", "external_reference", "external_url", "from_address", "id", "in_reply_to", "is_mock", "mail_account_id", "mail_thread_id", "organization_id", "project_id", "references_header", "reply_ref", "sent_at", "status", "subject", "template_id", "to_address", "updated_at") SELECT "body", "channel", "company_id", "contact_id", "created_at", "delivery_status", "direction", "external_reference", "external_url", "from_address", "id", "in_reply_to", "is_mock", "mail_account_id", "mail_thread_id", "organization_id", "project_id", "references_header", "reply_ref", "sent_at", "status", "subject", "template_id", "to_address", "updated_at" FROM "communications";
DROP TABLE "communications";
ALTER TABLE "new_communications" RENAME TO "communications";
CREATE INDEX "communications_organization_id_idx" ON "communications"("organization_id");
CREATE INDEX "communications_organization_id_status_idx" ON "communications"("organization_id", "status");
CREATE INDEX "communications_campaign_id_idx" ON "communications"("campaign_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "campaigns_organization_id_status_idx" ON "campaigns"("organization_id", "status");

