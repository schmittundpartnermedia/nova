-- NOVA Mail V1: accounts, threads, messages, attachments, follow-ups, audit.
ALTER TABLE "communications" ADD COLUMN "delivery_status" TEXT NOT NULL DEFAULT 'PREPARED';
ALTER TABLE "communications" ADD COLUMN "mail_account_id" TEXT;
ALTER TABLE "communications" ADD COLUMN "mail_thread_id" TEXT;
ALTER TABLE "communications" ADD COLUMN "in_reply_to" TEXT;
ALTER TABLE "communications" ADD COLUMN "references_header" TEXT;

CREATE TABLE "mail_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "credential_ref" TEXT,
    "last_sync_at" DATETIME,
    "sync_cursor" TEXT,
    "last_error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mail_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "participants" TEXT NOT NULL DEFAULT '[]',
    "last_message_at" DATETIME,
    "contact_id" TEXT,
    "company_id" TEXT,
    "project_id" TEXT,
    "link_confidence" REAL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_threads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "internet_message_id" TEXT,
    "folder" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "from_name" TEXT,
    "to_json" TEXT NOT NULL DEFAULT '[]',
    "cc_json" TEXT NOT NULL DEFAULT '[]',
    "bcc_json" TEXT NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL,
    "text_body" TEXT NOT NULL DEFAULT '',
    "html_body" TEXT,
    "normalized_text" TEXT NOT NULL DEFAULT '',
    "sent_at" DATETIME,
    "received_at" DATETIME,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "direction" TEXT NOT NULL,
    "headers_json" TEXT NOT NULL DEFAULT '{}',
    "classification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "priority_reason" TEXT,
    "injection_suspected" BOOLEAN NOT NULL DEFAULT false,
    "uid" INTEGER,
    "uid_validity" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "mail_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mail_attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content_id" TEXT,
    "knowledge_source_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skip_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mail_follow_ups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "expected_from" TEXT,
    "due_at" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "mail_follow_ups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mail_follow_ups_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "mail_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mail_audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "account_id" TEXT,
    "message_id" TEXT,
    "thread_id" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mail_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mail_accounts_organization_id_email_address_key" ON "mail_accounts"("organization_id", "email_address");
CREATE INDEX "mail_accounts_organization_id_status_idx" ON "mail_accounts"("organization_id", "status");
CREATE UNIQUE INDEX "mail_threads_organization_id_account_id_provider_thread_id_key" ON "mail_threads"("organization_id", "account_id", "provider_thread_id");
CREATE INDEX "mail_threads_organization_id_last_message_at_idx" ON "mail_threads"("organization_id", "last_message_at");
CREATE INDEX "mail_threads_organization_id_project_id_idx" ON "mail_threads"("organization_id", "project_id");
CREATE UNIQUE INDEX "mail_messages_organization_id_account_id_provider_message_id_key" ON "mail_messages"("organization_id", "account_id", "provider_message_id");
CREATE INDEX "mail_messages_organization_id_received_at_idx" ON "mail_messages"("organization_id", "received_at");
CREATE INDEX "mail_messages_organization_id_from_address_idx" ON "mail_messages"("organization_id", "from_address");
CREATE INDEX "mail_messages_thread_id_idx" ON "mail_messages"("thread_id");
CREATE INDEX "mail_attachments_organization_id_message_id_idx" ON "mail_attachments"("organization_id", "message_id");
CREATE INDEX "mail_follow_ups_organization_id_status_due_at_idx" ON "mail_follow_ups"("organization_id", "status", "due_at");
CREATE INDEX "mail_audit_events_organization_id_action_idx" ON "mail_audit_events"("organization_id", "action");
CREATE INDEX "mail_audit_events_organization_id_created_at_idx" ON "mail_audit_events"("organization_id", "created_at");
