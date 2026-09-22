-- CreateTable
CREATE TABLE "knowledge_imports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "user_request" TEXT NOT NULL,
    "root_path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERING',
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "progress_json" TEXT,
    "files_total" INTEGER NOT NULL DEFAULT 0,
    "files_success" INTEGER NOT NULL DEFAULT 0,
    "files_skipped" INTEGER NOT NULL DEFAULT 0,
    "files_failed" INTEGER NOT NULL DEFAULT 0,
    "items_created" INTEGER NOT NULL DEFAULT 0,
    "memory_updates" INTEGER NOT NULL DEFAULT 0,
    "relevant_files" INTEGER NOT NULL DEFAULT 0,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "error" TEXT,
    "metadata" TEXT,
    CONSTRAINT "knowledge_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_imports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "original_path" TEXT,
    "mime_type" TEXT,
    "checksum" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" DATETIME,
    "modified_at" DATETIME,
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "conversation_id" TEXT,
    "parent_source_id" TEXT,
    "version_group_id" TEXT,
    "version_label" TEXT,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "metadata" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "error" TEXT,
    "job_id" TEXT,
    "import_id" TEXT,
    "language" TEXT,
    "ocr_required" BOOLEAN NOT NULL DEFAULT false,
    "injection_suspected" BOOLEAN NOT NULL DEFAULT false,
    "skipped_reason" TEXT,
    "duplicate_of_id" TEXT,
    CONSTRAINT "knowledge_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "knowledge_sources_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "knowledge_sources_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "knowledge_imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_parsed_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "language" TEXT,
    "metadata" TEXT,
    "sections_json" TEXT NOT NULL,
    "tables_json" TEXT NOT NULL,
    "entities_json" TEXT NOT NULL,
    "dates_json" TEXT NOT NULL,
    "references_json" TEXT NOT NULL,
    "fulltext" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_parsed_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_parsed_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "normalized_key" TEXT,
    "normalized_value" TEXT,
    "entity_name" TEXT,
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "location_json" TEXT NOT NULL,
    "excerpt" TEXT,
    "extracted_at" DATETIME NOT NULL,
    "confidence" REAL NOT NULL,
    "extractor" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_of_id" TEXT,
    "contradiction_group_id" TEXT,
    "memory_entry_id" TEXT,
    "fulltext" TEXT NOT NULL,
    "embedding_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "knowledge_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "knowledge_items_memory_entry_id_fkey" FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_contradictions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "item_ids" TEXT NOT NULL,
    "values_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_contradictions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_embeddings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "source_id" TEXT,
    "item_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_embeddings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "knowledge_embeddings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "knowledge_embeddings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "knowledge_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "knowledge_source_id" TEXT,
    CONSTRAINT "new_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "new_sources_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "new_sources_knowledge_source_id_fkey" FOREIGN KEY ("knowledge_source_id") REFERENCES "knowledge_sources" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_sources" ("canonical_url", "created_at", "domain", "excerpt", "id", "job_id", "label", "metadata", "organization_id", "provider", "published_at", "reference", "retrieved_at", "title", "trust_score", "trust_tier", "type", "url")
SELECT "canonical_url", "created_at", "domain", "excerpt", "id", "job_id", "label", "metadata", "organization_id", "provider", "published_at", "reference", "retrieved_at", "title", "trust_score", "trust_tier", "type", "url" FROM "sources";
DROP TABLE "sources";
ALTER TABLE "new_sources" RENAME TO "sources";
CREATE INDEX "sources_organization_id_idx" ON "sources"("organization_id");
CREATE INDEX "sources_organization_id_job_id_idx" ON "sources"("organization_id", "job_id");
CREATE INDEX "sources_organization_id_url_idx" ON "sources"("organization_id", "url");
CREATE INDEX "sources_knowledge_source_id_idx" ON "sources"("knowledge_source_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "knowledge_imports_organization_id_status_idx" ON "knowledge_imports"("organization_id", "status");
CREATE INDEX "knowledge_imports_organization_id_started_at_idx" ON "knowledge_imports"("organization_id", "started_at");
CREATE INDEX "knowledge_sources_organization_id_idx" ON "knowledge_sources"("organization_id");
CREATE INDEX "knowledge_sources_organization_id_checksum_idx" ON "knowledge_sources"("organization_id", "checksum");
CREATE INDEX "knowledge_sources_organization_id_status_idx" ON "knowledge_sources"("organization_id", "status");
CREATE INDEX "knowledge_sources_organization_id_version_group_id_idx" ON "knowledge_sources"("organization_id", "version_group_id");
CREATE INDEX "knowledge_sources_import_id_idx" ON "knowledge_sources"("import_id");
CREATE UNIQUE INDEX "knowledge_parsed_documents_source_id_key" ON "knowledge_parsed_documents"("source_id");
CREATE INDEX "knowledge_parsed_documents_organization_id_idx" ON "knowledge_parsed_documents"("organization_id");
CREATE INDEX "knowledge_parsed_documents_organization_id_fulltext_idx" ON "knowledge_parsed_documents"("organization_id", "fulltext");
CREATE INDEX "knowledge_items_organization_id_idx" ON "knowledge_items"("organization_id");
CREATE INDEX "knowledge_items_organization_id_type_idx" ON "knowledge_items"("organization_id", "type");
CREATE INDEX "knowledge_items_organization_id_normalized_key_idx" ON "knowledge_items"("organization_id", "normalized_key");
CREATE INDEX "knowledge_items_organization_id_fulltext_idx" ON "knowledge_items"("organization_id", "fulltext");
CREATE INDEX "knowledge_items_source_id_idx" ON "knowledge_items"("source_id");
CREATE INDEX "knowledge_items_memory_entry_id_idx" ON "knowledge_items"("memory_entry_id");
CREATE INDEX "knowledge_contradictions_organization_id_idx" ON "knowledge_contradictions"("organization_id");
CREATE INDEX "knowledge_contradictions_organization_id_topic_idx" ON "knowledge_contradictions"("organization_id", "topic");
CREATE INDEX "knowledge_embeddings_organization_id_idx" ON "knowledge_embeddings"("organization_id");
CREATE INDEX "knowledge_embeddings_item_id_idx" ON "knowledge_embeddings"("item_id");
CREATE INDEX "knowledge_embeddings_source_id_idx" ON "knowledge_embeddings"("source_id");
