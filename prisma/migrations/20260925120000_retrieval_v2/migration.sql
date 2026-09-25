-- Retrieval V2: chunks, embeddings, usage. Legacy knowledge_embeddings bleiben erhalten.
CREATE TABLE "retrieval_chunks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "source_id" TEXT,
    "document_id" TEXT,
    "conversation_id" TEXT,
    "message_ids" TEXT,
    "project_id" TEXT,
    "page" INTEGER,
    "section" TEXT,
    "location_json" TEXT,
    "source_type" TEXT,
    "epistemic_status" TEXT,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "occurred_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "retrieval_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "retrieval_embeddings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "checksum" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retrieval_embeddings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "retrieval_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "retrieval_chunks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "embedding_usages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "texts" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embedding_usages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "retrieval_chunks_organization_id_object_type_object_id_checksum_key" ON "retrieval_chunks"("organization_id", "object_type", "object_id", "checksum");
CREATE INDEX "retrieval_chunks_organization_id_active_idx" ON "retrieval_chunks"("organization_id", "active");
CREATE INDEX "retrieval_chunks_organization_id_object_type_idx" ON "retrieval_chunks"("organization_id", "object_type");
CREATE INDEX "retrieval_chunks_organization_id_project_id_idx" ON "retrieval_chunks"("organization_id", "project_id");
CREATE INDEX "retrieval_chunks_organization_id_source_id_idx" ON "retrieval_chunks"("organization_id", "source_id");
CREATE INDEX "retrieval_chunks_organization_id_checksum_idx" ON "retrieval_chunks"("organization_id", "checksum");

CREATE UNIQUE INDEX "retrieval_embeddings_organization_id_chunk_id_provider_model_version_key" ON "retrieval_embeddings"("organization_id", "chunk_id", "provider", "model", "version");
CREATE INDEX "retrieval_embeddings_organization_id_provider_model_version_status_idx" ON "retrieval_embeddings"("organization_id", "provider", "model", "version", "status");
CREATE INDEX "retrieval_embeddings_organization_id_checksum_provider_model_version_idx" ON "retrieval_embeddings"("organization_id", "checksum", "provider", "model", "version");

CREATE INDEX "embedding_usages_organization_id_created_at_idx" ON "embedding_usages"("organization_id", "created_at");
