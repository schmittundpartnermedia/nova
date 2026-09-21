-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_conversation_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "input_mode" TEXT NOT NULL DEFAULT 'text',
    "status" TEXT NOT NULL DEFAULT 'final',
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "fulltext" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_conversation_messages" ("content", "conversation_id", "created_at", "id", "organization_id", "role") SELECT "content", "conversation_id", "created_at", "id", "organization_id", "role" FROM "conversation_messages";
DROP TABLE "conversation_messages";
ALTER TABLE "new_conversation_messages" RENAME TO "conversation_messages";
CREATE INDEX "conversation_messages_organization_id_idx" ON "conversation_messages"("organization_id");
CREATE INDEX "conversation_messages_conversation_id_idx" ON "conversation_messages"("conversation_id");
CREATE INDEX "conversation_messages_organization_id_created_at_idx" ON "conversation_messages"("organization_id", "created_at");
CREATE INDEX "conversation_messages_organization_id_fulltext_idx" ON "conversation_messages"("organization_id", "fulltext");
CREATE TABLE "new_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "title" TEXT,
    "origin" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "job_id" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "conversations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_conversations" ("created_at", "id", "organization_id", "origin", "title", "updated_at") SELECT "created_at", "id", "organization_id", "origin", "title", "updated_at" FROM "conversations";
DROP TABLE "conversations";
ALTER TABLE "new_conversations" RENAME TO "conversations";
CREATE INDEX "conversations_organization_id_idx" ON "conversations"("organization_id");
CREATE INDEX "conversations_organization_id_status_idx" ON "conversations"("organization_id", "status");
CREATE INDEX "conversations_organization_id_last_activity_at_idx" ON "conversations"("organization_id", "last_activity_at");
CREATE TABLE "new_memory_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "source_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_reference" TEXT,
    "source_url" TEXT,
    "conversation_message_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fulltext" TEXT NOT NULL,
    "embedding_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "memory_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memory_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "memory_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "memory_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "memory_entries_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "memory_entries_conversation_message_id_fkey" FOREIGN KEY ("conversation_message_id") REFERENCES "conversation_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_memory_entries" ("company_id", "contact_id", "content", "created_at", "embedding_ref", "fulltext", "id", "organization_id", "project_id", "source_id", "source_reference", "source_type", "source_url", "title", "type", "updated_at") SELECT "company_id", "contact_id", "content", "created_at", "embedding_ref", "fulltext", "id", "organization_id", "project_id", "source_id", "source_reference", "source_type", "source_url", "title", "type", "updated_at" FROM "memory_entries";
DROP TABLE "memory_entries";
ALTER TABLE "new_memory_entries" RENAME TO "memory_entries";
CREATE INDEX "memory_entries_organization_id_idx" ON "memory_entries"("organization_id");
CREATE INDEX "memory_entries_organization_id_type_idx" ON "memory_entries"("organization_id", "type");
CREATE INDEX "memory_entries_organization_id_fulltext_idx" ON "memory_entries"("organization_id", "fulltext");
CREATE INDEX "memory_entries_conversation_message_id_idx" ON "memory_entries"("conversation_message_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
