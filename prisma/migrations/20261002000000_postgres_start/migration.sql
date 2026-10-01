-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "source_id" TEXT,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "project_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "source_id" TEXT,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "due_at" TIMESTAMP(3),
    "follow_up_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "user_request" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resume_state" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "pause_reason" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "development_orders" (
    "id" TEXT NOT NULL,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "development_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_steps" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" TEXT NOT NULL,
    "output" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "task_id" TEXT,
    "communication_id" TEXT,
    "job_id" TEXT,
    "external_reference" TEXT,
    "external_url" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_entries" (
    "id" TEXT NOT NULL,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_relations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "location" TEXT,
    "notes" TEXT,
    "external_reference" TEXT,
    "external_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memos" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "meeting_id" TEXT,
    "project_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "decisions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "title" TEXT NOT NULL,
    "path" TEXT,
    "mime_type" TEXT,
    "content" TEXT,
    "external_reference" TEXT,
    "external_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communications" (
    "id" TEXT NOT NULL,
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
    "sent_at" TIMESTAMP(3),
    "delivery_status" TEXT NOT NULL DEFAULT 'PREPARED',
    "mail_account_id" TEXT,
    "from_address" TEXT,
    "to_address" TEXT,
    "reply_ref" TEXT,
    "campaign_id" TEXT,
    "recipient_name" TEXT,
    "vorlagen_werte" TEXT,
    "nachfass_zu" TEXT,
    "mail_thread_id" TEXT,
    "in_reply_to" TEXT,
    "references_header" TEXT,
    "template_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'outreach',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "mail_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "action_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "conditions" TEXT NOT NULL,
    "limits" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_works" (
    "id" TEXT NOT NULL,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "active_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT,
    "origin" TEXT NOT NULL,
    "external_id" TEXT,
    "checksum" TEXT,
    "imported_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "project_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "job_id" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "input_mode" TEXT NOT NULL DEFAULT 'text',
    "status" TEXT NOT NULL DEFAULT 'final',
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "fulltext" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT,
    "external_id" TEXT,
    "parent_external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "type" TEXT NOT NULL,
    "reference" TEXT,
    "url" TEXT,
    "canonical_url" TEXT,
    "title" TEXT,
    "domain" TEXT,
    "published_at" TIMESTAMP(3),
    "retrieved_at" TIMESTAMP(3),
    "provider" TEXT,
    "excerpt" TEXT,
    "trust_tier" TEXT,
    "trust_score" INTEGER,
    "metadata" TEXT,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "knowledge_source_id" TEXT,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "model" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computer_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "goal" TEXT NOT NULL,
    "user_request" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT,
    "result" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "computer_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computer_actions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "step_id" TEXT,
    "tool" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "risk_level" TEXT NOT NULL,
    "approval_id" TEXT,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "verification" TEXT,
    "error" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computer_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_contexts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "local_path" TEXT,
    "repository" TEXT,
    "branch" TEXT,
    "framework" TEXT,
    "architecture" TEXT,
    "rules" TEXT,
    "decisions" TEXT,
    "open_items" TEXT,
    "last_changes" TEXT,
    "last_analyzed_at" TIMESTAMP(3),
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cursor_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "project_id" TEXT,
    "project_path" TEXT NOT NULL,
    "repository" TEXT,
    "branch" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "cursor_session_id" TEXT,
    "initial_prompt" TEXT NOT NULL,
    "iterations" TEXT,
    "last_result" TEXT,
    "metadata" TEXT,

    CONSTRAINT "cursor_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "original_path" TEXT,
    "mime_type" TEXT,
    "checksum" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMP(3),
    "modified_at" TIMESTAMP(3),
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

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_parsed_documents" (
    "id" TEXT NOT NULL,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_parsed_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
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
    "extracted_at" TIMESTAMP(3) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "extractor" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_of_id" TEXT,
    "contradiction_group_id" TEXT,
    "memory_entry_id" TEXT,
    "conversation_message_id" TEXT,
    "epistemic_status" TEXT,
    "supersedes_id" TEXT,
    "fulltext" TEXT NOT NULL,
    "embedding_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_contradictions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "item_ids" TEXT NOT NULL,
    "values_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_contradictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_embeddings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source_id" TEXT,
    "item_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_imports" (
    "id" TEXT NOT NULL,
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
    "kind" TEXT NOT NULL DEFAULT 'document',
    "tokens_prompt" INTEGER NOT NULL DEFAULT 0,
    "tokens_completion" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "metadata" TEXT,

    CONSTRAINT "knowledge_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_chunks" (
    "id" TEXT NOT NULL,
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
    "occurred_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retrieval_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_embeddings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "checksum" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_usages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "texts" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embedding_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "capabilities" TEXT NOT NULL DEFAULT '[]',
    "credential_ref" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "sync_cursor" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_threads" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "participants" TEXT NOT NULL DEFAULT '[]',
    "last_message_at" TIMESTAMP(3),
    "contact_id" TEXT,
    "company_id" TEXT,
    "project_id" TEXT,
    "link_confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL,
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
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "direction" TEXT NOT NULL,
    "headers_json" TEXT NOT NULL DEFAULT '{}',
    "classification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "priority_reason" TEXT,
    "injection_suspected" BOOLEAN NOT NULL DEFAULT false,
    "uid" INTEGER,
    "uid_validity" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content_id" TEXT,
    "knowledge_source_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "skip_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_follow_ups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "expected_from" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_audit_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "account_id" TEXT,
    "message_id" TEXT,
    "thread_id" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "relative_path" TEXT NOT NULL,
    "artifact_id" TEXT,
    "job_id" TEXT,
    "source" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "job_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storage_path" TEXT,
    "external_reference" TEXT,
    "mime_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "version_group_id" TEXT NOT NULL,
    "knowledge_source_id" TEXT,
    "memory_entry_id" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "artifact_id" TEXT,
    "approval_request_id" TEXT,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "application" TEXT,
    "status" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "resume_step" TEXT,
    "ownership" TEXT,
    "instruction" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "job_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "idempotency_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "last_error" TEXT,
    "locked_by" TEXT,
    "locked_until" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "external_effect" TEXT NOT NULL DEFAULT 'none',
    "audit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_effects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "work_item_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "effect_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "work_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vorlage" TEXT NOT NULL,
    "liste" TEXT NOT NULL,
    "absender" TEXT NOT NULL,
    "abstand_minuten" INTEGER NOT NULL,
    "art" TEXT NOT NULL DEFAULT 'kampagne',
    "status" TEXT NOT NULL DEFAULT 'wartet_auf_freigabe',
    "approval_id" TEXT,
    "nachfass_tage" INTEGER,
    "nachfass_vorlage" TEXT,
    "ungueltig" TEXT NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
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
    "geprueft_at" TIMESTAMP(3),
    "campaign_id" TEXT,
    "entwurf_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plattformen" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kategorie" TEXT,
    "begruendung" TEXT,
    "konto_angelegt" BOOLEAN NOT NULL DEFAULT false,
    "profil_ausgefuellt" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'offen',
    "letzter_schritt" TEXT,
    "naechster_schritt" TEXT,
    "reihenfolge" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plattformen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "termine" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "beginn" TIMESTAMP(3) NOT NULL,
    "dauer_minuten" INTEGER NOT NULL DEFAULT 30,
    "notiz" TEXT,
    "erinnerung_minuten" INTEGER NOT NULL DEFAULT 15,
    "status" TEXT NOT NULL DEFAULT 'geplant',
    "quelle_id" TEXT,
    "kalender_name" TEXT,
    "kalender_uid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "termine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members"("organization_id");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");

-- CreateIndex
CREATE INDEX "companies_organization_id_idx" ON "companies"("organization_id");

-- CreateIndex
CREATE INDEX "companies_organization_id_name_idx" ON "companies"("organization_id", "name");

-- CreateIndex
CREATE INDEX "contacts_organization_id_idx" ON "contacts"("organization_id");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_idx" ON "tasks"("organization_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_status_idx" ON "tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "jobs_organization_id_idx" ON "jobs"("organization_id");

-- CreateIndex
CREATE INDEX "jobs_organization_id_status_idx" ON "jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "development_orders_organization_id_status_idx" ON "development_orders"("organization_id", "status");

-- CreateIndex
CREATE INDEX "job_steps_organization_id_idx" ON "job_steps"("organization_id");

-- CreateIndex
CREATE INDEX "job_steps_job_id_idx" ON "job_steps"("job_id");

-- CreateIndex
CREATE INDEX "activities_organization_id_timestamp_idx" ON "activities"("organization_id", "timestamp");

-- CreateIndex
CREATE INDEX "activities_organization_id_type_idx" ON "activities"("organization_id", "type");

-- CreateIndex
CREATE INDEX "memory_entries_organization_id_idx" ON "memory_entries"("organization_id");

-- CreateIndex
CREATE INDEX "memory_entries_organization_id_type_idx" ON "memory_entries"("organization_id", "type");

-- CreateIndex
CREATE INDEX "memory_entries_organization_id_fulltext_idx" ON "memory_entries"("organization_id", "fulltext");

-- CreateIndex
CREATE INDEX "memory_entries_conversation_message_id_idx" ON "memory_entries"("conversation_message_id");

-- CreateIndex
CREATE INDEX "memory_relations_organization_id_idx" ON "memory_relations"("organization_id");

-- CreateIndex
CREATE INDEX "memory_relations_from_id_idx" ON "memory_relations"("from_id");

-- CreateIndex
CREATE INDEX "memory_relations_to_id_idx" ON "memory_relations"("to_id");

-- CreateIndex
CREATE INDEX "meetings_organization_id_idx" ON "meetings"("organization_id");

-- CreateIndex
CREATE INDEX "memos_organization_id_idx" ON "memos"("organization_id");

-- CreateIndex
CREATE INDEX "documents_organization_id_idx" ON "documents"("organization_id");

-- CreateIndex
CREATE INDEX "communications_organization_id_idx" ON "communications"("organization_id");

-- CreateIndex
CREATE INDEX "communications_organization_id_status_idx" ON "communications"("organization_id", "status");

-- CreateIndex
CREATE INDEX "communications_campaign_id_idx" ON "communications"("campaign_id");

-- CreateIndex
CREATE INDEX "mail_templates_organization_id_kind_idx" ON "mail_templates"("organization_id", "kind");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_idx" ON "approval_requests"("organization_id");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_status_idx" ON "approval_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "approval_policies_organization_id_idx" ON "approval_policies"("organization_id");

-- CreateIndex
CREATE INDEX "active_works_organization_id_status_idx" ON "active_works"("organization_id", "status");

-- CreateIndex
CREATE INDEX "active_works_organization_id_conversation_id_idx" ON "active_works"("organization_id", "conversation_id");

-- CreateIndex
CREATE INDEX "conversations_organization_id_idx" ON "conversations"("organization_id");

-- CreateIndex
CREATE INDEX "conversations_organization_id_status_idx" ON "conversations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "conversations_organization_id_last_activity_at_idx" ON "conversations"("organization_id", "last_activity_at");

-- CreateIndex
CREATE INDEX "conversations_organization_id_origin_external_id_idx" ON "conversations"("organization_id", "origin", "external_id");

-- CreateIndex
CREATE INDEX "conversation_messages_organization_id_idx" ON "conversation_messages"("organization_id");

-- CreateIndex
CREATE INDEX "conversation_messages_conversation_id_idx" ON "conversation_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_messages_organization_id_created_at_idx" ON "conversation_messages"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_messages_organization_id_fulltext_idx" ON "conversation_messages"("organization_id", "fulltext");

-- CreateIndex
CREATE INDEX "conversation_messages_organization_id_external_id_idx" ON "conversation_messages"("organization_id", "external_id");

-- CreateIndex
CREATE INDEX "sources_organization_id_idx" ON "sources"("organization_id");

-- CreateIndex
CREATE INDEX "sources_organization_id_job_id_idx" ON "sources"("organization_id", "job_id");

-- CreateIndex
CREATE INDEX "sources_organization_id_url_idx" ON "sources"("organization_id", "url");

-- CreateIndex
CREATE INDEX "sources_knowledge_source_id_idx" ON "sources"("knowledge_source_id");

-- CreateIndex
CREATE INDEX "connector_configs_organization_id_idx" ON "connector_configs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "connector_configs_organization_id_type_provider_key" ON "connector_configs"("organization_id", "type", "provider");

-- CreateIndex
CREATE INDEX "ai_provider_configs_organization_id_idx" ON "ai_provider_configs"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_configs_organization_id_role_key" ON "ai_provider_configs"("organization_id", "role");

-- CreateIndex
CREATE INDEX "computer_jobs_organization_id_status_idx" ON "computer_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "computer_jobs_organization_id_started_at_idx" ON "computer_jobs"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "computer_actions_organization_id_started_at_idx" ON "computer_actions"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "computer_actions_organization_id_job_id_idx" ON "computer_actions"("organization_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_contexts_project_id_key" ON "project_contexts"("project_id");

-- CreateIndex
CREATE INDEX "project_contexts_organization_id_idx" ON "project_contexts"("organization_id");

-- CreateIndex
CREATE INDEX "cursor_sessions_organization_id_status_idx" ON "cursor_sessions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "cursor_sessions_organization_id_job_id_idx" ON "cursor_sessions"("organization_id", "job_id");

-- CreateIndex
CREATE INDEX "knowledge_sources_organization_id_idx" ON "knowledge_sources"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_sources_organization_id_checksum_idx" ON "knowledge_sources"("organization_id", "checksum");

-- CreateIndex
CREATE INDEX "knowledge_sources_organization_id_status_idx" ON "knowledge_sources"("organization_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_sources_organization_id_version_group_id_idx" ON "knowledge_sources"("organization_id", "version_group_id");

-- CreateIndex
CREATE INDEX "knowledge_sources_import_id_idx" ON "knowledge_sources"("import_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_parsed_documents_source_id_key" ON "knowledge_parsed_documents"("source_id");

-- CreateIndex
CREATE INDEX "knowledge_parsed_documents_organization_id_idx" ON "knowledge_parsed_documents"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_parsed_documents_organization_id_fulltext_idx" ON "knowledge_parsed_documents"("organization_id", "fulltext");

-- CreateIndex
CREATE INDEX "knowledge_items_organization_id_idx" ON "knowledge_items"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_items_organization_id_type_idx" ON "knowledge_items"("organization_id", "type");

-- CreateIndex
CREATE INDEX "knowledge_items_organization_id_normalized_key_idx" ON "knowledge_items"("organization_id", "normalized_key");

-- CreateIndex
CREATE INDEX "knowledge_items_organization_id_fulltext_idx" ON "knowledge_items"("organization_id", "fulltext");

-- CreateIndex
CREATE INDEX "knowledge_items_source_id_idx" ON "knowledge_items"("source_id");

-- CreateIndex
CREATE INDEX "knowledge_items_memory_entry_id_idx" ON "knowledge_items"("memory_entry_id");

-- CreateIndex
CREATE INDEX "knowledge_items_conversation_message_id_idx" ON "knowledge_items"("conversation_message_id");

-- CreateIndex
CREATE INDEX "knowledge_items_organization_id_epistemic_status_idx" ON "knowledge_items"("organization_id", "epistemic_status");

-- CreateIndex
CREATE INDEX "knowledge_contradictions_organization_id_idx" ON "knowledge_contradictions"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_contradictions_organization_id_topic_idx" ON "knowledge_contradictions"("organization_id", "topic");

-- CreateIndex
CREATE INDEX "knowledge_embeddings_organization_id_idx" ON "knowledge_embeddings"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_embeddings_item_id_idx" ON "knowledge_embeddings"("item_id");

-- CreateIndex
CREATE INDEX "knowledge_embeddings_source_id_idx" ON "knowledge_embeddings"("source_id");

-- CreateIndex
CREATE INDEX "knowledge_imports_organization_id_status_idx" ON "knowledge_imports"("organization_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_imports_organization_id_started_at_idx" ON "knowledge_imports"("organization_id", "started_at");

-- CreateIndex
CREATE INDEX "retrieval_chunks_organization_id_active_idx" ON "retrieval_chunks"("organization_id", "active");

-- CreateIndex
CREATE INDEX "retrieval_chunks_organization_id_object_type_idx" ON "retrieval_chunks"("organization_id", "object_type");

-- CreateIndex
CREATE INDEX "retrieval_chunks_organization_id_project_id_idx" ON "retrieval_chunks"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "retrieval_chunks_organization_id_source_id_idx" ON "retrieval_chunks"("organization_id", "source_id");

-- CreateIndex
CREATE INDEX "retrieval_chunks_organization_id_checksum_idx" ON "retrieval_chunks"("organization_id", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "retrieval_chunks_organization_id_object_type_object_id_chec_key" ON "retrieval_chunks"("organization_id", "object_type", "object_id", "checksum");

-- CreateIndex
CREATE INDEX "retrieval_embeddings_organization_id_provider_model_version_idx" ON "retrieval_embeddings"("organization_id", "provider", "model", "version", "status");

-- CreateIndex
CREATE INDEX "retrieval_embeddings_organization_id_checksum_provider_mode_idx" ON "retrieval_embeddings"("organization_id", "checksum", "provider", "model", "version");

-- CreateIndex
CREATE UNIQUE INDEX "retrieval_embeddings_organization_id_chunk_id_provider_mode_key" ON "retrieval_embeddings"("organization_id", "chunk_id", "provider", "model", "version");

-- CreateIndex
CREATE INDEX "embedding_usages_organization_id_created_at_idx" ON "embedding_usages"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "mail_accounts_organization_id_status_idx" ON "mail_accounts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mail_accounts_organization_id_email_address_key" ON "mail_accounts"("organization_id", "email_address");

-- CreateIndex
CREATE INDEX "mail_threads_organization_id_last_message_at_idx" ON "mail_threads"("organization_id", "last_message_at");

-- CreateIndex
CREATE INDEX "mail_threads_organization_id_project_id_idx" ON "mail_threads"("organization_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_threads_organization_id_account_id_provider_thread_id_key" ON "mail_threads"("organization_id", "account_id", "provider_thread_id");

-- CreateIndex
CREATE INDEX "mail_messages_organization_id_received_at_idx" ON "mail_messages"("organization_id", "received_at");

-- CreateIndex
CREATE INDEX "mail_messages_organization_id_from_address_idx" ON "mail_messages"("organization_id", "from_address");

-- CreateIndex
CREATE INDEX "mail_messages_thread_id_idx" ON "mail_messages"("thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "mail_messages_organization_id_account_id_provider_message_i_key" ON "mail_messages"("organization_id", "account_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "mail_attachments_organization_id_message_id_idx" ON "mail_attachments"("organization_id", "message_id");

-- CreateIndex
CREATE INDEX "mail_follow_ups_organization_id_status_due_at_idx" ON "mail_follow_ups"("organization_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "mail_audit_events_organization_id_action_idx" ON "mail_audit_events"("organization_id", "action");

-- CreateIndex
CREATE INDEX "mail_audit_events_organization_id_created_at_idx" ON "mail_audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_entries_organization_id_kind_idx" ON "workspace_entries"("organization_id", "kind");

-- CreateIndex
CREATE INDEX "workspace_entries_organization_id_artifact_id_idx" ON "workspace_entries"("organization_id", "artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_entries_organization_id_relative_path_key" ON "workspace_entries"("organization_id", "relative_path");

-- CreateIndex
CREATE INDEX "artifacts_organization_id_type_idx" ON "artifacts"("organization_id", "type");

-- CreateIndex
CREATE INDEX "artifacts_organization_id_version_group_id_idx" ON "artifacts"("organization_id", "version_group_id");

-- CreateIndex
CREATE INDEX "artifacts_organization_id_status_idx" ON "artifacts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "artifacts_job_id_idx" ON "artifacts"("job_id");

-- CreateIndex
CREATE INDEX "review_sessions_organization_id_status_idx" ON "review_sessions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "review_sessions_job_id_idx" ON "review_sessions"("job_id");

-- CreateIndex
CREATE INDEX "work_items_organization_id_status_run_at_idx" ON "work_items"("organization_id", "status", "run_at");

-- CreateIndex
CREATE INDEX "work_items_job_id_idx" ON "work_items"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_organization_id_idempotency_key_key" ON "work_items"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "work_effects_work_item_id_idx" ON "work_effects"("work_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_effects_organization_id_idempotency_key_key" ON "work_effects"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "campaigns_organization_id_status_idx" ON "campaigns"("organization_id", "status");

-- CreateIndex
CREATE INDEX "leads_organization_id_status_idx" ON "leads"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_organization_id_email_key" ON "leads"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "plattformen_organization_id_name_key" ON "plattformen"("organization_id", "name");

-- CreateIndex
CREATE INDEX "termine_organization_id_beginn_idx" ON "termine"("organization_id", "beginn");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_orders" ADD CONSTRAINT "development_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_orders" ADD CONSTRAINT "development_orders_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_conversation_message_id_fkey" FOREIGN KEY ("conversation_message_id") REFERENCES "conversation_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_relations" ADD CONSTRAINT "memory_relations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_relations" ADD CONSTRAINT "memory_relations_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_relations" ADD CONSTRAINT "memory_relations_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "memory_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memos" ADD CONSTRAINT "memos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memos" ADD CONSTRAINT "memos_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memos" ADD CONSTRAINT "memos_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "mail_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_works" ADD CONSTRAINT "active_works_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_knowledge_source_id_fkey" FOREIGN KEY ("knowledge_source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_configs" ADD CONSTRAINT "connector_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computer_jobs" ADD CONSTRAINT "computer_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computer_jobs" ADD CONSTRAINT "computer_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computer_actions" ADD CONSTRAINT "computer_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "computer_actions" ADD CONSTRAINT "computer_actions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contexts" ADD CONSTRAINT "project_contexts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contexts" ADD CONSTRAINT "project_contexts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cursor_sessions" ADD CONSTRAINT "cursor_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cursor_sessions" ADD CONSTRAINT "cursor_sessions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cursor_sessions" ADD CONSTRAINT "cursor_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "knowledge_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_parsed_documents" ADD CONSTRAINT "knowledge_parsed_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_parsed_documents" ADD CONSTRAINT "knowledge_parsed_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_memory_entry_id_fkey" FOREIGN KEY ("memory_entry_id") REFERENCES "memory_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_contradictions" ADD CONSTRAINT "knowledge_contradictions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "knowledge_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_imports" ADD CONSTRAINT "knowledge_imports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_imports" ADD CONSTRAINT "knowledge_imports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_chunks" ADD CONSTRAINT "retrieval_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_embeddings" ADD CONSTRAINT "retrieval_embeddings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_embeddings" ADD CONSTRAINT "retrieval_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "retrieval_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embedding_usages" ADD CONSTRAINT "embedding_usages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "mail_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "mail_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_follow_ups" ADD CONSTRAINT "mail_follow_ups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_follow_ups" ADD CONSTRAINT "mail_follow_ups_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "mail_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_audit_events" ADD CONSTRAINT "mail_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_entries" ADD CONSTRAINT "workspace_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_entries" ADD CONSTRAINT "workspace_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_effects" ADD CONSTRAINT "work_effects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_effects" ADD CONSTRAINT "work_effects_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plattformen" ADD CONSTRAINT "plattformen_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "termine" ADD CONSTRAINT "termine_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

