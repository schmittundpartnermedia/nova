-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "external_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN "checksum" TEXT;
ALTER TABLE "conversations" ADD COLUMN "imported_at" DATETIME;
CREATE INDEX "conversations_organization_id_origin_external_id_idx" ON "conversations"("organization_id", "origin", "external_id");

-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN "external_id" TEXT;
ALTER TABLE "conversation_messages" ADD COLUMN "parent_external_id" TEXT;
CREATE INDEX "conversation_messages_organization_id_external_id_idx" ON "conversation_messages"("organization_id", "external_id");

-- AlterTable
ALTER TABLE "knowledge_items" ADD COLUMN "conversation_message_id" TEXT;
ALTER TABLE "knowledge_items" ADD COLUMN "epistemic_status" TEXT;
ALTER TABLE "knowledge_items" ADD COLUMN "supersedes_id" TEXT;
CREATE INDEX "knowledge_items_conversation_message_id_idx" ON "knowledge_items"("conversation_message_id");
CREATE INDEX "knowledge_items_organization_id_epistemic_status_idx" ON "knowledge_items"("organization_id", "epistemic_status");

-- AlterTable
ALTER TABLE "knowledge_imports" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'document';
ALTER TABLE "knowledge_imports" ADD COLUMN "tokens_prompt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "knowledge_imports" ADD COLUMN "tokens_completion" INTEGER NOT NULL DEFAULT 0;
