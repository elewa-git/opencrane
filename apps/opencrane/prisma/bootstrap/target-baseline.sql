-- OpenCrane target database baseline.
-- Applied once by CloudNativePG while creating an empty application database.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentServiceKind" AS ENUM ('personal', 'managed');

-- CreateEnum
CREATE TYPE "AgentServiceOwnerScope" AS ENUM ('organization', 'department', 'team', 'project', 'personal', 'user');

-- CreateEnum
CREATE TYPE "AgentServiceState" AS ENUM ('draft', 'active', 'paused', 'retired');

-- CreateEnum
CREATE TYPE "AgentRevisionState" AS ENUM ('draft', 'published', 'rejected', 'retired');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('document', 'generated', 'skill', 'upload');

-- CreateEnum
CREATE TYPE "ArtifactState" AS ENUM ('active', 'deletion_pending', 'deleted');

-- CreateEnum
CREATE TYPE "ArtifactRevisionState" AS ENUM ('published', 'deletion_pending', 'purged');

-- CreateEnum
CREATE TYPE "ArtifactIndexState" AS ENUM ('pending', 'indexed', 'failed', 'removal_pending', 'removed');

-- CreateEnum
CREATE TYPE "ArtifactOutboxEventKind" AS ENUM ('artifact.revision_published', 'artifact.sharing_changed', 'artifact.deletion_requested');

-- CreateEnum
CREATE TYPE "ArtifactUploadLeaseState" AS ENUM ('active', 'promoted', 'finalized', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "AuditDecisionOutcome" AS ENUM ('allow', 'deny', 'error');

-- CreateEnum
CREATE TYPE "AuditDecisionActorKind" AS ENUM ('user', 'agent-service', 'workload', 'system');

-- CreateEnum
CREATE TYPE "AuthorizationScopeKind" AS ENUM ('organization', 'department', 'team', 'project', 'personal', 'direct-user');

-- CreateEnum
CREATE TYPE "AuthorizationEffect" AS ENUM ('allow', 'deny');

-- CreateEnum
CREATE TYPE "ApprovalRequestState" AS ENUM ('pending', 'approved', 'denied', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "ActionExecutionState" AS ENUM ('reserved', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ActionReplayMode" AS ENUM ('one_shot', 'idempotent');

-- CreateEnum
CREATE TYPE "ParticipationEventKind" AS ENUM ('agent_card', 'skill_execution', 'heartbeat');

-- CreateEnum
CREATE TYPE "ChannelInvocationAction" AS ENUM ('command.forward', 'events.read');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "OrgMemberStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "DocProposalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ConversationThreadState" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('user', 'assistant', 'tool', 'system');

-- CreateEnum
CREATE TYPE "ConversationMessageState" AS ENUM ('pending', 'streaming', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "GrantScope" AS ENUM ('org', 'department', 'team', 'project', 'personal');

-- CreateEnum
CREATE TYPE "GrantSubjectType" AS ENUM ('group', 'tenant', 'user');

-- CreateEnum
CREATE TYPE "GrantAccess" AS ENUM ('allow', 'deny');

-- CreateEnum
CREATE TYPE "GrantPayloadType" AS ENUM ('awareness', 'mcp-server');

-- CreateEnum
CREATE TYPE "IntegrationState" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "IntegrationCustodyState" AS ENUM ('ready', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "McpServerTransport" AS ENUM ('streamable-http', 'sse', 'websocket');

-- CreateEnum
CREATE TYPE "McpServerStatus" AS ENUM ('active', 'degraded', 'draft');

-- CreateEnum
CREATE TYPE "McpServerType" AS ENUM ('single-user', 'multi-user', 'remote-oauth');

-- CreateEnum
CREATE TYPE "McpApprovalStatus" AS ENUM ('pending-review', 'approved', 'published', 'disabled');

-- CreateEnum
CREATE TYPE "McpConnectionStatus" AS ENUM ('needs-credential', 'activating', 'connected', 'oauth-connected', 'shared-key', 'activation-failed');

-- CreateEnum
CREATE TYPE "FleetMembershipScopeKind" AS ENUM ('organization', 'department', 'team', 'project', 'personal', 'direct-user');

-- CreateEnum
CREATE TYPE "MemoryDatasetState" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "MemoryFactState" AS ENUM ('active', 'corrected', 'forget_pending', 'forgotten');

-- CreateEnum
CREATE TYPE "MemoryConsentState" AS ENUM ('explicit', 'confirmed');

-- CreateEnum
CREATE TYPE "MemoryOutboxEventKind" AS ENUM ('memory.fact_recorded', 'memory.fact_corrected', 'memory.forget_requested');

-- CreateEnum
CREATE TYPE "PersonaInterviewCategory" AS ENUM ('relationship_role', 'tone_language', 'answer_structure', 'challenge_support', 'initiative', 'approval_risk', 'working_habits', 'memory_boundaries');

-- CreateEnum
CREATE TYPE "PersonaQuestionSetState" AS ENUM ('draft', 'reviewed');

-- CreateEnum
CREATE TYPE "PersonaInterviewState" AS ENUM ('in_progress', 'completed', 'retaken');

-- CreateEnum
CREATE TYPE "PersonaRevisionState" AS ENUM ('draft', 'approved');

-- CreateEnum
CREATE TYPE "ModelRoutingScope" AS ENUM ('global', 'clusterTenant');

-- CreateEnum
CREATE TYPE "DatasetScope" AS ENUM ('org', 'team', 'department', 'project', 'personal');

-- CreateEnum
CREATE TYPE "ThirdPartySourceKind" AS ENUM ('mcp-registry', 'anthropic-skills', 'git-repository', 'manual-upload');

-- CreateEnum
CREATE TYPE "ThirdPartySourceStatus" AS ENUM ('healthy', 'syncing', 'error', 'pending-approval');

-- CreateEnum
CREATE TYPE "ThirdPartySourceItemKind" AS ENUM ('mcp-server');

-- CreateEnum
CREATE TYPE "AgentRunTrigger" AS ENUM ('interactive', 'schedule', 'managed_invocation');

-- CreateEnum
CREATE TYPE "AgentRunState" AS ENUM ('accepted', 'queued', 'assigned', 'running', 'waiting_for_approval', 'cancelling', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AgentRunTerminalReason" AS ENUM ('success', 'user_cancelled', 'policy_denied', 'budget_exhausted', 'runtime_failure', 'invalid_input');

-- CreateEnum
CREATE TYPE "WorkloadAssignmentState" AS ENUM ('pending_pod', 'registered', 'revoked');

-- CreateEnum
CREATE TYPE "WorkloadKind" AS ENUM ('job', 'deployment');

-- CreateEnum
CREATE TYPE "RunOutboxEventKind" AS ENUM ('run.accepted', 'run.attempt_requested', 'run.workload_release_requested', 'run.workload_cleanup_requested', 'run.cancellation_requested', 'run.resume_requested');

-- CreateEnum
CREATE TYPE "RuntimeCommandKind" AS ENUM ('start_attempt', 'resume_attempt', 'cancel_attempt');

-- CreateEnum
CREATE TYPE "SkillState" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "SkillRevisionState" AS ENUM ('draft', 'review', 'published', 'rejected', 'revoked');

-- CreateEnum
CREATE TYPE "SkillTrustClass" AS ENUM ('reviewed_instructions', 'sandboxed_python');

-- CreateTable
CREATE TABLE "agent_services" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "kind" "AgentServiceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "owner_scope" "AgentServiceOwnerScope" NOT NULL,
    "owner_subject_id" TEXT NOT NULL,
    "state" "AgentServiceState" NOT NULL DEFAULT 'draft',
    "active_revision_id" TEXT,
    "workload_profile" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_revisions" (
    "id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" "AgentRevisionState" NOT NULL DEFAULT 'draft',
    "digest" TEXT NOT NULL,
    "prompt_policy_version" TEXT NOT NULL,
    "persona_revision_id" TEXT,
    "model_policy_id" TEXT NOT NULL,
    "budget" JSONB NOT NULL,
    "authored_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "agent_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_revision_skill_assignments" (
    "agent_revision_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "skill_revision_id" TEXT NOT NULL,

    CONSTRAINT "agent_revision_skill_assignments_pkey" PRIMARY KEY ("agent_revision_id","skill_id")
);

-- CreateTable
CREATE TABLE "agent_revision_integration_assignments" (
    "agent_revision_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "custody_reference_id" TEXT NOT NULL,
    "allowed_tools" TEXT[],

    CONSTRAINT "agent_revision_integration_assignments_pkey" PRIMARY KEY ("agent_revision_id","integration_id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "owner_principal_id" TEXT NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "state" "ArtifactState" NOT NULL DEFAULT 'active',
    "current_revision_id" TEXT,
    "retention_policy" TEXT NOT NULL DEFAULT 'until_authorized_deletion',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_upload_leases" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "capability_jti" TEXT NOT NULL,
    "expected_content_address" TEXT,
    "expected_byte_length" BIGINT,
    "media_type" TEXT NOT NULL,
    "state" "ArtifactUploadLeaseState" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "promotion_receipt_digest" TEXT,
    "promoted_content_address" TEXT,
    "promoted_byte_length" BIGINT,
    "promoted_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_upload_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_revisions" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" "ArtifactRevisionState" NOT NULL DEFAULT 'published',
    "content_address" TEXT NOT NULL,
    "byte_length" BIGINT NOT NULL,
    "media_type" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "source_run_id" TEXT,
    "source_message_id" TEXT,
    "index_state" "ArtifactIndexState" NOT NULL DEFAULT 'pending',
    "cognee_external_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletion_requested_at" TIMESTAMP(3),
    "purged_at" TIMESTAMP(3),

    CONSTRAINT "artifact_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_revision_parents" (
    "child_revision_id" TEXT NOT NULL,
    "parent_revision_id" TEXT NOT NULL,

    CONSTRAINT "artifact_revision_parents_pkey" PRIMARY KEY ("child_revision_id","parent_revision_id")
);

-- CreateTable
CREATE TABLE "artifact_outbox_events" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "kind" "ArtifactOutboxEventKind" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "delivery_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_decisions" (
    "id" TEXT NOT NULL,
    "decision_digest" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "actor_kind" "AuditDecisionActorKind" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "audience" TEXT,
    "namespace" TEXT,
    "service_account_name" TEXT,
    "workload_kind" "WorkloadKind",
    "workload_uid" TEXT,
    "pod_uid" TEXT,
    "run_id" TEXT,
    "attempt" INTEGER,
    "agent_service_id" TEXT,
    "agent_revision_id" TEXT,
    "proof_key_id" TEXT,
    "proof_key_thumbprint" TEXT,
    "resource_kind" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "catalog_digest" TEXT NOT NULL,
    "arguments_digest" TEXT NOT NULL,
    "policy_revision_hash" TEXT NOT NULL,
    "effective_authorization_digest" TEXT NOT NULL,
    "membership_revision" INTEGER,
    "outcome" "AuditDecisionOutcome" NOT NULL,
    "reason_code" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_grants" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "scope_kind" "AuthorizationScopeKind" NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_resource_id" TEXT,
    "catalog_id" TEXT NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "catalog_digest" TEXT NOT NULL,
    "capability_id" TEXT NOT NULL,
    "resource_kind" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "effect" "AuthorizationEffect" NOT NULL,
    "priority" INTEGER NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_catalog_revisions" (
    "id" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capability_catalog_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "proof_key_id" TEXT NOT NULL,
    "proof_key_thumbprint" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "workload_audience" TEXT NOT NULL,
    "service_account_name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "workload_kind" "WorkloadKind" NOT NULL,
    "workload_uid" TEXT NOT NULL,
    "pod_uid" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "catalog_digest" TEXT NOT NULL,
    "capability_id" TEXT NOT NULL,
    "resource_kind" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "arguments_digest" TEXT NOT NULL,
    "action_digest" TEXT NOT NULL,
    "approver_policy_revision" TEXT NOT NULL,
    "effective_policy_digest" TEXT NOT NULL,
    "state" "ApprovalRequestState" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "resume_token_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_execution_receipts" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "service_account_name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "workload_kind" "WorkloadKind" NOT NULL,
    "workload_uid" TEXT NOT NULL,
    "pod_uid" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "proof_key_id" TEXT NOT NULL,
    "proof_key_thumbprint" TEXT NOT NULL,
    "catalog_id" TEXT NOT NULL,
    "catalog_revision" INTEGER NOT NULL,
    "catalog_digest" TEXT NOT NULL,
    "capability_id" TEXT NOT NULL,
    "effective_policy_digest" TEXT NOT NULL,
    "resource_kind" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "arguments_digest" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "replay_mode" "ActionReplayMode" NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "state" "ActionExecutionState" NOT NULL DEFAULT 'reserved',
    "result" JSONB,
    "failure_code" TEXT,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "action_execution_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_documents" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "team_scope" TEXT,
    "department_scope" TEXT,
    "project_scope" TEXT,
    "sensitivity_tags" TEXT[],
    "title" TEXT,
    "content" TEXT NOT NULL,
    "content_hash" TEXT,
    "confidentiality" TEXT,
    "jurisdiction" TEXT,
    "retention_class" TEXT,
    "acl_origin" TEXT NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "freshness_recorded_at" TIMESTAMP(3) NOT NULL,
    "ingest_cursor" TEXT NOT NULL,
    "embedding_ready" BOOLEAN NOT NULL DEFAULT false,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvesting_cursors" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cursor_value" TEXT NOT NULL,
    "last_sync_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "harvesting_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awareness_rollouts" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "target_version" TEXT NOT NULL,
    "stable_version" TEXT NOT NULL,
    "waves" JSONB NOT NULL,
    "promoted_waves" JSONB NOT NULL,
    "shadow_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "awareness_rollouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participation_events" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "kind" "ParticipationEventKind" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "outcome" TEXT,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_participation" (
    "tenant" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "running_contract_version" TEXT,
    "agent_card" JSONB,
    "skill_execution_count" INTEGER NOT NULL DEFAULT 0,
    "policy_violation_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_participation_pkey" PRIMARY KEY ("tenant")
);

-- CreateTable
CREATE TABLE "channel_runtime_routes" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "action" "ChannelInvocationAction" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "channel_runtime_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_invocation_contexts" (
    "id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "action" "ChannelInvocationAction" NOT NULL,
    "route_id" TEXT NOT NULL,
    "run_id" TEXT,
    "membership_revision" INTEGER NOT NULL,
    "authorization_digest" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_invocation_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "cluster_tenant" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" "OrgMemberStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_docs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_doc_versions" (
    "id" TEXT NOT NULL,
    "company_doc_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_doc_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_workspace_docs" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "doc_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "last_reconciled_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_workspace_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_merge_proposals" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "doc_name" TEXT NOT NULL,
    "base_version" INTEGER NOT NULL,
    "target_version" INTEGER NOT NULL,
    "proposed_content" TEXT NOT NULL,
    "diff" TEXT NOT NULL,
    "status" "DocProposalStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,

    CONSTRAINT "doc_merge_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_threads" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "state" "ConversationThreadState" NOT NULL DEFAULT 'active',
    "context_revision_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("thread_id","user_id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    "user_id" TEXT,
    "role" "ConversationMessageRole" NOT NULL,
    "state" "ConversationMessageState" NOT NULL,
    "source" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_run_events" (
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_run_events_pkey" PRIMARY KEY ("run_id","sequence")
);

-- CreateTable
CREATE TABLE "conversation_context_revisions" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "through_message_id" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "created_by_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_context_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grants" (
    "id" TEXT NOT NULL,
    "payload_type" "GrantPayloadType" NOT NULL,
    "payload_id" TEXT NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "subject_type" "GrantSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "access" "GrantAccess" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "shared_by" TEXT,
    "group_id" TEXT,
    "mcp_server_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "description" TEXT,
    "members" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "obot_catalog_entry_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "state" "IntegrationState" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_custody_references" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "obot_custody_reference" TEXT NOT NULL,
    "state" "IntegrationCustodyState" NOT NULL DEFAULT 'ready',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_custody_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "endpoint" TEXT NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "transport" "McpServerTransport" NOT NULL,
    "status" "McpServerStatus" NOT NULL DEFAULT 'draft',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publisher" TEXT,
    "glyph" TEXT,
    "server_type" "McpServerType" NOT NULL DEFAULT 'single-user',
    "approval_status" "McpApprovalStatus" NOT NULL DEFAULT 'pending-review',
    "credential_schema" JSONB NOT NULL DEFAULT '[]',
    "entitlement_summary" TEXT,
    "source_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_installs" (
    "id" TEXT NOT NULL,
    "mcp_server_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_status" "McpConnectionStatus" NOT NULL DEFAULT 'needs-credential',
    "credential_ref" TEXT,
    "connected_account" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_installs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_access_policies" (
    "id" TEXT NOT NULL,
    "mcp_server_id" TEXT NOT NULL,
    "everyone_in_org" BOOLEAN NOT NULL DEFAULT false,
    "groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_access_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_access_users" (
    "id" TEXT NOT NULL,
    "access_policy_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_server_access_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_grants" (
    "id" TEXT NOT NULL,
    "mcp_server_id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "subject_type" "GrantSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "access" "GrantAccess" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_credentials" (
    "id" TEXT NOT NULL,
    "mcp_server_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_fleet_membership_revisions" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "issuer_id" TEXT NOT NULL,
    "issuer_key_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_fleet_membership_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_fleet_membership_assertions" (
    "id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "scope_kind" "FleetMembershipScopeKind" NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_resource_id" TEXT,

    CONSTRAINT "verified_fleet_membership_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "highest_accepted_fleet_memberships" (
    "issuer_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "revision_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "highest_accepted_fleet_memberships_pkey" PRIMARY KEY ("issuer_id","silo_id")
);

-- CreateTable
CREATE TABLE "memory_datasets" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "scope_kind" "AuthorizationScopeKind" NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scope_resource_id" TEXT,
    "cognee_dataset_id" TEXT NOT NULL,
    "state" "MemoryDatasetState" NOT NULL DEFAULT 'active',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),

    CONSTRAINT "memory_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_fact_catalog" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "cognee_external_id" TEXT NOT NULL,
    "content_digest" TEXT NOT NULL,
    "state" "MemoryFactState" NOT NULL DEFAULT 'active',
    "consent_state" "MemoryConsentState" NOT NULL,
    "sensitivity" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "source_artifact_revision_id" TEXT,
    "source_message_id" TEXT,
    "supersedes_fact_id" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "corrected_at" TIMESTAMP(3),
    "forget_requested_at" TIMESTAMP(3),
    "forgotten_at" TIMESTAMP(3),

    CONSTRAINT "memory_fact_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_outbox_events" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "fact_id" TEXT NOT NULL,
    "kind" "MemoryOutboxEventKind" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "delivery_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_metric_snapshots" (
    "id" SERIAL NOT NULL,
    "cpu_percent" DOUBLE PRECISION NOT NULL,
    "memory_used_bytes" BIGINT NOT NULL,
    "memory_total_bytes" BIGINT NOT NULL,
    "storage_used_bytes" BIGINT NOT NULL,
    "storage_total_bytes" BIGINT NOT NULL,
    "active_tenants" INTEGER NOT NULL DEFAULT 0,
    "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_routing_defaults" (
    "id" TEXT NOT NULL,
    "scope" "ModelRoutingScope" NOT NULL DEFAULT 'global',
    "cluster_tenant" TEXT,
    "default_model" TEXT,
    "auto_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_routing_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_question_sets" (
    "question_set_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "PersonaQuestionSetState" NOT NULL DEFAULT 'draft',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persona_question_sets_pkey" PRIMARY KEY ("question_set_id","version")
);

-- CreateTable
CREATE TABLE "persona_questions" (
    "question_set_id" TEXT NOT NULL,
    "question_set_version" INTEGER NOT NULL,
    "question_id" TEXT NOT NULL,
    "category" "PersonaInterviewCategory" NOT NULL,
    "prompt" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "persona_questions_pkey" PRIMARY KEY ("question_set_id","question_set_version","question_id")
);

-- CreateTable
CREATE TABLE "persona_soul_templates" (
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "selection_rules" JSONB NOT NULL,
    "reviewed_by" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persona_soul_templates_pkey" PRIMARY KEY ("template_id","version")
);

-- CreateTable
CREATE TABLE "persona_profiles" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "active_revision_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persona_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_interviews" (
    "id" TEXT NOT NULL,
    "persona_profile_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question_set_id" TEXT NOT NULL,
    "question_set_version" INTEGER NOT NULL,
    "state" "PersonaInterviewState" NOT NULL DEFAULT 'in_progress',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "persona_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_interview_answers" (
    "id" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "question_set_id" TEXT NOT NULL,
    "question_set_version" INTEGER NOT NULL,
    "question_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "answered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persona_interview_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_revisions" (
    "id" TEXT NOT NULL,
    "persona_profile_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" "PersonaRevisionState" NOT NULL DEFAULT 'draft',
    "soul_template_id" TEXT NOT NULL,
    "soul_template_version" INTEGER NOT NULL,
    "soul_template_digest" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "selection_rule_id" TEXT NOT NULL,
    "selection_answer_ids" TEXT[],
    "compiled_instructions" TEXT NOT NULL,
    "previous_revision_id" TEXT,
    "authored_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "durable_soul_mutation_policy" TEXT NOT NULL DEFAULT 'forbidden',

    CONSTRAINT "persona_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_insights" (
    "id" TEXT NOT NULL,
    "persona_revision_id" TEXT NOT NULL,
    "category" "PersonaInterviewCategory" NOT NULL,
    "statement" TEXT NOT NULL,
    "interview_id" TEXT NOT NULL,
    "question_set_id" TEXT NOT NULL,
    "question_set_version" INTEGER NOT NULL,
    "question_id" TEXT NOT NULL,
    "answer_id" TEXT NOT NULL,

    CONSTRAINT "persona_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_policies" (
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tenant_selector" JSONB,
    "domains" JSONB,
    "egress_rules" JSONB,
    "mcp_servers" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_policies_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "provider_api_keys" (
    "provider" TEXT NOT NULL,
    "key_value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_api_keys_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "provider_credentials" (
    "id" TEXT NOT NULL,
    "scope" "ModelRoutingScope" NOT NULL DEFAULT 'global',
    "cluster_tenant" TEXT,
    "provider" TEXT NOT NULL,
    "secret_ref" TEXT NOT NULL,
    "litellm_credential_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_definitions" (
    "id" TEXT NOT NULL,
    "scope" "ModelRoutingScope" NOT NULL DEFAULT 'global',
    "cluster_tenant" TEXT,
    "public_model_name" TEXT NOT NULL,
    "litellm_model_id" TEXT NOT NULL,
    "upstream_model" TEXT NOT NULL,
    "api_base" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "provider_credential_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_dataset_memberships" (
    "tenant" TEXT NOT NULL,
    "scope" "DatasetScope" NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_dataset_memberships_pkey" PRIMARY KEY ("tenant","scope","subject")
);

-- CreateTable
CREATE TABLE "third_party_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ThirdPartySourceKind" NOT NULL,
    "status" "ThirdPartySourceStatus" NOT NULL DEFAULT 'pending-approval',
    "origin_url" TEXT NOT NULL,
    "sync_mode" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "third_party_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "third_party_source_items" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "kind" "ThirdPartySourceItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "upstream_id" TEXT NOT NULL,
    "version" TEXT,
    "digest" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "third_party_source_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "trigger" "AgentRunTrigger" NOT NULL,
    "delegated_user_id" TEXT,
    "request_idempotency_key" TEXT NOT NULL,
    "root_run_id" TEXT NOT NULL,
    "parent_run_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "state" "AgentRunState" NOT NULL DEFAULT 'accepted',
    "effective_contract_digest" TEXT NOT NULL,
    "input_snapshot_digest" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "terminal_reason" "AgentRunTerminalReason",
    "cost_amount" DECIMAL(18,6),
    "cost_currency" TEXT,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_input_snapshots" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "snapshot_version" INTEGER NOT NULL,
    "silo_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "effective_contract_digest" TEXT NOT NULL,
    "persona_revision_id" TEXT,
    "thread_id" TEXT,
    "message_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preference_fact_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "artifact_revision_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memory_facts" JSONB NOT NULL,
    "identity_snapshot" JSONB NOT NULL,
    "model_route" JSONB NOT NULL,
    "tool_grant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skill_revision_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "memory_query_policy" JSONB NOT NULL,
    "budget_policy" JSONB NOT NULL,
    "capability_set_digest" TEXT NOT NULL,
    "prompt_compiler_version" TEXT NOT NULL,
    "input_digest" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_input_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workload_assignments" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "service_account_name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "workload_kind" "WorkloadKind" NOT NULL,
    "workload_uid" TEXT NOT NULL,
    "workload_profile" TEXT NOT NULL,
    "pod_uid" TEXT,
    "state" "WorkloadAssignmentState" NOT NULL DEFAULT 'pending_pod',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "workload_assignments_pkey" PRIMARY KEY ("run_id","attempt")
);

-- CreateTable
CREATE TABLE "workload_bootstraps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "service_account_name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "workload_kind" "WorkloadKind" NOT NULL,
    "workload_uid" TEXT NOT NULL,
    "claim_digest" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_by_pod_uid" TEXT,
    "receipt_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workload_bootstraps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_proof_keys" (
    "id" TEXT NOT NULL,
    "bootstrap_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "workload_kind" "WorkloadKind" NOT NULL,
    "workload_uid" TEXT NOT NULL,
    "pod_uid" TEXT NOT NULL,
    "public_key_jwk" JSONB NOT NULL,
    "key_thumbprint" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_proof_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_outbox_events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "RunOutboxEventKind" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "delivery_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_command_streams" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "fence" INTEGER NOT NULL DEFAULT 1,
    "runtime_instance_id" TEXT,
    "next_command_sequence" INTEGER NOT NULL DEFAULT 1,
    "accepted_candidate_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_command_streams_pkey" PRIMARY KEY ("run_id","attempt")
);

-- CreateTable
CREATE TABLE "runtime_dispatched_commands" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "command_id" TEXT NOT NULL,
    "kind" "RuntimeCommandKind" NOT NULL,
    "fence" INTEGER NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_dispatched_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "owner_principal_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "state" "SkillState" NOT NULL DEFAULT 'active',
    "current_revision_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_revisions" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" "SkillRevisionState" NOT NULL DEFAULT 'draft',
    "artifact_id" TEXT NOT NULL,
    "artifact_revision_id" TEXT NOT NULL,
    "artifact_content_address" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "requirements" JSONB NOT NULL,
    "test_report" JSONB,
    "scan_result" JSONB,
    "trust_class" "SkillTrustClass" NOT NULL,
    "signature" TEXT,
    "signer_key_id" TEXT,
    "authored_by" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "skill_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_litellm_keys" (
    "id" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "key_alias" TEXT NOT NULL,
    "secret_name" TEXT NOT NULL,
    "monthly_budget_usd" DECIMAL(12,2),
    "issued_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_litellm_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usage_snapshots" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "total_cost" DECIMAL(12,4) NOT NULL,
    "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_budget_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "ceiling_amount" DECIMAL(12,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_budget_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_budget_settings" (
    "user_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "ceiling_amount" DECIMAL(12,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_budget_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "team" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'Pending',
    "ingress_host" TEXT,
    "cluster_tenant_ref" TEXT,
    "subject" TEXT,
    "awareness_wave" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "agent_services_silo_id_owner_scope_owner_subject_id_idx" ON "agent_services"("silo_id", "owner_scope", "owner_subject_id");

-- CreateIndex
CREATE INDEX "agent_services_silo_id_kind_state_idx" ON "agent_services"("silo_id", "kind", "state");

-- CreateIndex
CREATE UNIQUE INDEX "agent_services_id_active_revision_id_key" ON "agent_services"("id", "active_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_services_id_silo_id_key" ON "agent_services"("id", "silo_id");

-- CreateIndex
CREATE INDEX "agent_revisions_digest_idx" ON "agent_revisions"("digest");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revisions_agent_service_id_revision_key" ON "agent_revisions"("agent_service_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revisions_agent_service_id_id_key" ON "agent_revisions"("agent_service_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revisions_agent_service_id_digest_key" ON "agent_revisions"("agent_service_id", "digest");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revision_skill_assignments_agent_revision_id_skill_re_key" ON "agent_revision_skill_assignments"("agent_revision_id", "skill_revision_id");

-- CreateIndex
CREATE INDEX "agent_revision_integration_assignments_integration_id_silo__idx" ON "agent_revision_integration_assignments"("integration_id", "silo_id");

-- CreateIndex
CREATE INDEX "artifacts_silo_id_owner_principal_id_state_idx" ON "artifacts"("silo_id", "owner_principal_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_id_current_revision_id_key" ON "artifacts"("id", "current_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_id_silo_id_key" ON "artifacts"("id", "silo_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_upload_leases_capability_jti_key" ON "artifact_upload_leases"("capability_jti");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_upload_leases_promotion_receipt_digest_key" ON "artifact_upload_leases"("promotion_receipt_digest");

-- CreateIndex
CREATE INDEX "artifact_upload_leases_artifact_id_state_expires_at_idx" ON "artifact_upload_leases"("artifact_id", "state", "expires_at");

-- CreateIndex
CREATE INDEX "artifact_upload_leases_silo_id_state_expires_at_idx" ON "artifact_upload_leases"("silo_id", "state", "expires_at");

-- CreateIndex
CREATE INDEX "artifact_revisions_content_address_state_idx" ON "artifact_revisions"("content_address", "state");

-- CreateIndex
CREATE INDEX "artifact_revisions_source_run_id_idx" ON "artifact_revisions"("source_run_id");

-- CreateIndex
CREATE INDEX "artifact_revisions_index_state_created_at_idx" ON "artifact_revisions"("index_state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_revisions_artifact_id_revision_key" ON "artifact_revisions"("artifact_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_revisions_artifact_id_id_key" ON "artifact_revisions"("artifact_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_revisions_id_content_address_key" ON "artifact_revisions"("id", "content_address");

-- CreateIndex
CREATE INDEX "artifact_revision_parents_parent_revision_id_idx" ON "artifact_revision_parents"("parent_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_outbox_events_idempotency_key_key" ON "artifact_outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "artifact_outbox_events_published_at_available_at_idx" ON "artifact_outbox_events"("published_at", "available_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_idx" ON "audit_log"("tenant");

-- CreateIndex
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "audit_decisions_decision_digest_key" ON "audit_decisions"("decision_digest");

-- CreateIndex
CREATE INDEX "audit_decisions_silo_id_decided_at_idx" ON "audit_decisions"("silo_id", "decided_at");

-- CreateIndex
CREATE INDEX "audit_decisions_run_id_attempt_decided_at_idx" ON "audit_decisions"("run_id", "attempt", "decided_at");

-- CreateIndex
CREATE INDEX "audit_decisions_resource_kind_resource_id_decided_at_idx" ON "audit_decisions"("resource_kind", "resource_id", "decided_at");

-- CreateIndex
CREATE INDEX "audit_decisions_actor_kind_actor_id_decided_at_idx" ON "audit_decisions"("actor_kind", "actor_id", "decided_at");

-- CreateIndex
CREATE INDEX "authorization_grants_silo_id_subject_id_scope_kind_organiza_idx" ON "authorization_grants"("silo_id", "subject_id", "scope_kind", "organization_id", "scope_resource_id");

-- CreateIndex
CREATE INDEX "authorization_grants_silo_id_resource_kind_resource_id_prio_idx" ON "authorization_grants"("silo_id", "resource_kind", "resource_id", "priority");

-- CreateIndex
CREATE INDEX "authorization_grants_catalog_id_catalog_revision_capability_idx" ON "authorization_grants"("catalog_id", "catalog_revision", "capability_id");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"("silo_id", "subject_id", "scope_kind", "organization_id", "scope_resource_id", "catalog_id", "catalog_revision", "capability_id", "resource_kind", "resource_id", "effect", "priority") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "capability_catalog_revisions_catalog_id_revision_key" ON "capability_catalog_revisions"("catalog_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "capability_catalog_revisions_catalog_id_digest_key" ON "capability_catalog_revisions"("catalog_id", "digest");

-- CreateIndex
CREATE UNIQUE INDEX "capability_catalog_revisions_catalog_id_revision_digest_key" ON "capability_catalog_revisions"("catalog_id", "revision", "digest");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_resume_token_hash_key" ON "approval_requests"("resume_token_hash");

-- CreateIndex
CREATE INDEX "approval_requests_state_expires_at_idx" ON "approval_requests"("state", "expires_at");

-- CreateIndex
CREATE INDEX "approval_requests_subject_id_idx" ON "approval_requests"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_run_id_attempt_action_digest_key" ON "approval_requests"("run_id", "attempt", "action_digest");

-- CreateIndex
CREATE UNIQUE INDEX "action_execution_receipts_jti_key" ON "action_execution_receipts"("jti");

-- CreateIndex
CREATE UNIQUE INDEX "action_execution_receipts_request_fingerprint_key" ON "action_execution_receipts"("request_fingerprint");

-- CreateIndex
CREATE INDEX "action_execution_receipts_run_id_attempt_state_idx" ON "action_execution_receipts"("run_id", "attempt", "state");

-- CreateIndex
CREATE INDEX "action_execution_receipts_replay_mode_state_idx" ON "action_execution_receipts"("replay_mode", "state");

-- CreateIndex
CREATE INDEX "org_documents_source_idx" ON "org_documents"("source");

-- CreateIndex
CREATE INDEX "org_documents_owner_idx" ON "org_documents"("owner");

-- CreateIndex
CREATE INDEX "org_documents_team_scope_idx" ON "org_documents"("team_scope");

-- Preserve the target query indexes for department and project document scope.
CREATE INDEX "org_documents_department_scope_idx" ON "org_documents"("department_scope");
CREATE INDEX "org_documents_project_scope_idx" ON "org_documents"("project_scope");

-- CreateIndex
CREATE UNIQUE INDEX "org_documents_source_source_id_key" ON "org_documents"("source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "harvesting_cursors_source_key" ON "harvesting_cursors"("source");

-- CreateIndex
CREATE INDEX "participation_events_tenant_idx" ON "participation_events"("tenant");

-- CreateIndex
CREATE UNIQUE INDEX "participation_events_tenant_idempotency_key_key" ON "participation_events"("tenant", "idempotency_key");

-- CreateIndex
CREATE INDEX "channel_runtime_routes_current_lookup_idx" ON "channel_runtime_routes"("silo_id", "agent_service_id", "action", "is_current", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "channel_runtime_routes_exact_target_key" ON "channel_runtime_routes"("id", "silo_id", "agent_service_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "channel_invocation_contexts_digest_key" ON "channel_invocation_contexts"("digest");

-- CreateIndex
CREATE INDEX "channel_invocation_contexts_digest_expiry_idx" ON "channel_invocation_contexts"("digest", "expires_at");

-- CreateIndex
CREATE INDEX "channel_invocation_contexts_route_expiry_idx" ON "channel_invocation_contexts"("route_id", "expires_at");

-- CreateIndex
CREATE INDEX "channel_invocation_contexts_subject_thread_idx" ON "channel_invocation_contexts"("subject_id", "silo_id", "thread_id", "created_at");

-- CreateIndex
CREATE INDEX "org_memberships_subject_idx" ON "org_memberships"("subject");

-- CreateIndex
CREATE INDEX "org_memberships_cluster_tenant_idx" ON "org_memberships"("cluster_tenant");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_cluster_tenant_subject_key" ON "org_memberships"("cluster_tenant", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "company_docs_name_key" ON "company_docs"("name");

-- CreateIndex
CREATE INDEX "company_doc_versions_company_doc_id_idx" ON "company_doc_versions"("company_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_doc_versions_company_doc_id_version_key" ON "company_doc_versions"("company_doc_id", "version");

-- CreateIndex
CREATE INDEX "tenant_workspace_docs_tenant_idx" ON "tenant_workspace_docs"("tenant");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_workspace_docs_tenant_doc_name_key" ON "tenant_workspace_docs"("tenant", "doc_name");

-- CreateIndex
CREATE INDEX "doc_merge_proposals_tenant_doc_name_idx" ON "doc_merge_proposals"("tenant", "doc_name");

-- CreateIndex
CREATE INDEX "doc_merge_proposals_status_idx" ON "doc_merge_proposals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "doc_merge_proposals_tenant_doc_name_target_version_key" ON "doc_merge_proposals"("tenant", "doc_name", "target_version");

-- CreateIndex
CREATE INDEX "conversation_threads_silo_id_agent_service_id_state_idx" ON "conversation_threads"("silo_id", "agent_service_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_threads_id_silo_id_key" ON "conversation_threads"("id", "silo_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_threads_exact_service_key" ON "conversation_threads"("id", "silo_id", "agent_service_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_threads_id_context_revision_id_key" ON "conversation_threads"("id", "context_revision_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_thread_id_idx" ON "conversation_participants"("user_id", "thread_id");

-- CreateIndex
CREATE INDEX "conversation_messages_thread_id_created_at_id_idx" ON "conversation_messages"("thread_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "conversation_messages_run_id_idx" ON "conversation_messages"("run_id");

-- CreateIndex
CREATE INDEX "conversation_run_events_run_id_occurred_at_idx" ON "conversation_run_events"("run_id", "occurred_at");

-- CreateIndex
CREATE INDEX "conversation_context_revisions_created_by_run_id_idx" ON "conversation_context_revisions"("created_by_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_context_revisions_thread_id_revision_key" ON "conversation_context_revisions"("thread_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_context_revisions_thread_id_id_key" ON "conversation_context_revisions"("thread_id", "id");

-- CreateIndex
CREATE INDEX "grants_payload_type_payload_id_idx" ON "grants"("payload_type", "payload_id");

-- CreateIndex
CREATE INDEX "grants_subject_type_subject_id_idx" ON "grants"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "grants_shared_by_idx" ON "grants"("shared_by");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE INDEX "groups_scope_idx" ON "groups"("scope");

-- CreateIndex
CREATE INDEX "integrations_silo_id_state_idx" ON "integrations"("silo_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_id_silo_id_key" ON "integrations"("id", "silo_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_silo_id_obot_catalog_entry_id_key" ON "integrations"("silo_id", "obot_catalog_entry_id");

-- CreateIndex
CREATE INDEX "integration_custody_references_integration_id_state_expires_idx" ON "integration_custody_references"("integration_id", "state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_custody_references_id_integration_id_silo_id_key" ON "integration_custody_references"("id", "integration_id", "silo_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_custody_references_obot_custody_reference_key" ON "integration_custody_references"("obot_custody_reference");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_name_key" ON "mcp_servers"("name");

-- CreateIndex
CREATE INDEX "mcp_servers_scope_idx" ON "mcp_servers"("scope");

-- CreateIndex
CREATE INDEX "mcp_servers_approval_status_idx" ON "mcp_servers"("approval_status");

-- CreateIndex
CREATE INDEX "mcp_server_installs_user_id_idx" ON "mcp_server_installs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_installs_mcp_server_id_user_id_key" ON "mcp_server_installs"("mcp_server_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_access_policies_mcp_server_id_key" ON "mcp_server_access_policies"("mcp_server_id");

-- CreateIndex
CREATE INDEX "mcp_server_access_users_user_id_idx" ON "mcp_server_access_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_access_users_access_policy_id_user_id_key" ON "mcp_server_access_users"("access_policy_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_grants_grant_id_key" ON "mcp_server_grants"("grant_id");

-- CreateIndex
CREATE INDEX "mcp_server_grants_mcp_server_id_idx" ON "mcp_server_grants"("mcp_server_id");

-- CreateIndex
CREATE INDEX "mcp_server_credentials_mcp_server_id_idx" ON "mcp_server_credentials"("mcp_server_id");

-- CreateIndex
CREATE INDEX "verified_fleet_membership_revisions_silo_id_expires_at_idx" ON "verified_fleet_membership_revisions"("silo_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "verified_fleet_membership_revisions_issuer_id_silo_id_revis_key" ON "verified_fleet_membership_revisions"("issuer_id", "silo_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "verified_fleet_membership_revisions_issuer_id_silo_id_paylo_key" ON "verified_fleet_membership_revisions"("issuer_id", "silo_id", "payload_digest");

-- CreateIndex
CREATE UNIQUE INDEX "verified_membership_identity_key" ON "verified_fleet_membership_revisions"("id", "issuer_id", "silo_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "verified_fleet_membership_revisions_id_silo_id_key" ON "verified_fleet_membership_revisions"("id", "silo_id");

-- CreateIndex
CREATE INDEX "verified_fleet_membership_assertions_silo_id_subject_id_sco_idx" ON "verified_fleet_membership_assertions"("silo_id", "subject_id", "scope_kind", "organization_id", "scope_resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "verified_fleet_membership_assertions_revision_id_assertion__key" ON "verified_fleet_membership_assertions"("revision_id", "assertion_id");

-- CreateIndex
CREATE UNIQUE INDEX "highest_accepted_fleet_memberships_revision_id_key" ON "highest_accepted_fleet_memberships"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "highest_membership_identity_key" ON "highest_accepted_fleet_memberships"("revision_id", "issuer_id", "silo_id", "revision");

-- CreateIndex
CREATE INDEX "memory_datasets_silo_id_state_idx" ON "memory_datasets"("silo_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "memory_datasets_silo_id_cognee_dataset_id_key" ON "memory_datasets"("silo_id", "cognee_dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_datasets_silo_id_scope_kind_organization_id_scope_re_key" ON "memory_datasets"("silo_id", "scope_kind", "organization_id", "scope_resource_id");

-- CreateIndex
CREATE INDEX "memory_fact_catalog_source_artifact_revision_id_idx" ON "memory_fact_catalog"("source_artifact_revision_id");

-- CreateIndex
CREATE INDEX "memory_fact_catalog_source_message_id_idx" ON "memory_fact_catalog"("source_message_id");

-- CreateIndex
CREATE INDEX "memory_fact_catalog_dataset_id_state_idx" ON "memory_fact_catalog"("dataset_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "memory_fact_catalog_dataset_id_cognee_external_id_key" ON "memory_fact_catalog"("dataset_id", "cognee_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_fact_catalog_id_dataset_id_key" ON "memory_fact_catalog"("id", "dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "memory_outbox_events_idempotency_key_key" ON "memory_outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "memory_outbox_events_published_at_available_at_idx" ON "memory_outbox_events"("published_at", "available_at");

-- CreateIndex
CREATE INDEX "server_metric_snapshots_sampled_at_idx" ON "server_metric_snapshots"("sampled_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_routing_defaults_scope_cluster_tenant_key" ON "model_routing_defaults"("scope", "cluster_tenant");

-- CreateIndex
CREATE INDEX "persona_questions_question_set_id_question_set_version_cate_idx" ON "persona_questions"("question_set_id", "question_set_version", "category");

-- CreateIndex
CREATE UNIQUE INDEX "persona_questions_question_set_id_question_set_version_ordi_key" ON "persona_questions"("question_set_id", "question_set_version", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "persona_soul_templates_template_id_digest_key" ON "persona_soul_templates"("template_id", "digest");

-- CreateIndex
CREATE UNIQUE INDEX "persona_profiles_silo_id_user_id_key" ON "persona_profiles"("silo_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "persona_profiles_id_user_id_key" ON "persona_profiles"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "persona_profiles_id_active_revision_id_key" ON "persona_profiles"("id", "active_revision_id");

-- CreateIndex
CREATE INDEX "persona_interviews_persona_profile_id_state_idx" ON "persona_interviews"("persona_profile_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "persona_interviews_id_persona_profile_id_user_id_question_s_key" ON "persona_interviews"("id", "persona_profile_id", "user_id", "question_set_id", "question_set_version");

-- CreateIndex
CREATE INDEX "persona_interview_answers_question_set_id_question_set_vers_idx" ON "persona_interview_answers"("question_set_id", "question_set_version", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "persona_interview_answers_interview_id_question_id_key" ON "persona_interview_answers"("interview_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "persona_interview_answers_id_interview_id_question_set_id_q_key" ON "persona_interview_answers"("id", "interview_id", "question_set_id", "question_set_version", "question_id");

-- CreateIndex
CREATE INDEX "persona_revisions_interview_id_idx" ON "persona_revisions"("interview_id");

-- CreateIndex
CREATE UNIQUE INDEX "persona_revisions_persona_profile_id_revision_key" ON "persona_revisions"("persona_profile_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "persona_revisions_persona_profile_id_id_key" ON "persona_revisions"("persona_profile_id", "id");

-- CreateIndex
CREATE INDEX "persona_insights_answer_id_interview_id_question_set_id_que_idx" ON "persona_insights"("answer_id", "interview_id", "question_set_id", "question_set_version", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "persona_insights_persona_revision_id_id_key" ON "persona_insights"("persona_revision_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "persona_insights_persona_revision_id_answer_id_key" ON "persona_insights"("persona_revision_id", "answer_id");

-- CreateIndex
CREATE INDEX "provider_credentials_cluster_tenant_idx" ON "provider_credentials"("cluster_tenant");

-- CreateIndex
CREATE UNIQUE INDEX "provider_credentials_scope_cluster_tenant_provider_key" ON "provider_credentials"("scope", "cluster_tenant", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "model_definitions_litellm_model_id_key" ON "model_definitions"("litellm_model_id");

-- CreateIndex
CREATE INDEX "model_definitions_cluster_tenant_idx" ON "model_definitions"("cluster_tenant");

-- CreateIndex
CREATE UNIQUE INDEX "model_definitions_scope_cluster_tenant_public_model_name_key" ON "model_definitions"("scope", "cluster_tenant", "public_model_name");

-- CreateIndex
CREATE INDEX "tenant_dataset_memberships_tenant_scope_idx" ON "tenant_dataset_memberships"("tenant", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "third_party_sources_name_key" ON "third_party_sources"("name");

-- CreateIndex
CREATE INDEX "third_party_source_items_source_id_idx" ON "third_party_source_items"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "third_party_source_items_source_id_kind_upstream_id_key" ON "third_party_source_items"("source_id", "kind", "upstream_id");

-- CreateIndex
CREATE INDEX "agent_runs_agent_service_id_state_idx" ON "agent_runs"("agent_service_id", "state");

-- CreateIndex
CREATE INDEX "agent_runs_thread_id_accepted_at_idx" ON "agent_runs"("thread_id", "accepted_at");

-- CreateIndex
CREATE INDEX "agent_runs_root_run_id_idx" ON "agent_runs"("root_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_silo_id_request_idempotency_key_key" ON "agent_runs"("silo_id", "request_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_id_agent_service_id_agent_revision_id_key" ON "agent_runs"("id", "agent_service_id", "agent_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_id_silo_id_agent_service_id_agent_revision_id_key" ON "agent_runs"("id", "silo_id", "agent_service_id", "agent_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_id_agent_revision_id_key" ON "agent_runs"("id", "agent_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_id_input_snapshot_digest_key" ON "agent_runs"("id", "input_snapshot_digest");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_snapshot_identity_key" ON "agent_runs"("id", "input_snapshot_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest");

-- CreateIndex
CREATE UNIQUE INDEX "run_input_snapshots_run_id_key" ON "run_input_snapshots"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_input_snapshots_input_digest_key" ON "run_input_snapshots"("input_digest");

-- CreateIndex
CREATE INDEX "run_input_snapshots_agent_service_id_agent_revision_id_idx" ON "run_input_snapshots"("agent_service_id", "agent_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_input_snapshots_run_id_input_digest_key" ON "run_input_snapshots"("run_id", "input_digest");

-- CreateIndex
CREATE UNIQUE INDEX "run_input_snapshot_run_identity_key" ON "run_input_snapshots"("run_id", "input_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest");

-- CreateIndex
CREATE INDEX "workload_assignments_silo_id_subject_id_idx" ON "workload_assignments"("silo_id", "subject_id");

-- CreateIndex
CREATE INDEX "workload_assignments_state_expires_at_idx" ON "workload_assignments"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workload_assignment_bootstrap_identity_key" ON "workload_assignments"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "audience", "service_account_name", "namespace", "workload_kind", "workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "workload_assignment_action_identity_key" ON "workload_assignments"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "service_account_name", "namespace", "workload_kind", "workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "workload_assignments_run_attempt_workload_key" ON "workload_assignments"("run_id", "attempt", "workload_kind", "workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "workload_assignments_run_attempt_workload_pod_key" ON "workload_assignments"("run_id", "attempt", "workload_kind", "workload_uid", "pod_uid");

-- CreateIndex
CREATE UNIQUE INDEX "workload_assignments_namespace_workload_kind_workload_uid_key" ON "workload_assignments"("namespace", "workload_kind", "workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "workload_assignments_namespace_pod_uid_key" ON "workload_assignments"("namespace", "pod_uid");

-- CreateIndex
CREATE UNIQUE INDEX "workload_bootstraps_claim_digest_key" ON "workload_bootstraps"("claim_digest");

-- CreateIndex
CREATE UNIQUE INDEX "workload_bootstraps_receipt_id_key" ON "workload_bootstraps"("receipt_id");

-- CreateIndex
CREATE INDEX "workload_bootstraps_expires_at_idx" ON "workload_bootstraps"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "workload_bootstraps_run_id_attempt_key" ON "workload_bootstraps"("run_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "workload_bootstrap_assignment_identity_key" ON "workload_bootstraps"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "audience", "service_account_name", "namespace", "workload_kind", "workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_keys_bootstrap_id_key" ON "run_proof_keys"("bootstrap_id");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_keys_key_thumbprint_key" ON "run_proof_keys"("key_thumbprint");

-- CreateIndex
CREATE INDEX "run_proof_keys_pod_uid_idx" ON "run_proof_keys"("pod_uid");

-- CreateIndex
CREATE INDEX "run_proof_keys_expires_at_idx" ON "run_proof_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_keys_run_id_attempt_key" ON "run_proof_keys"("run_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_keys_run_id_attempt_workload_kind_workload_uid_key" ON "run_proof_keys"("run_id", "attempt", "workload_kind", "workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_keys_run_id_attempt_workload_kind_workload_uid_po_key" ON "run_proof_keys"("run_id", "attempt", "workload_kind", "workload_uid", "pod_uid");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_keys_id_run_id_attempt_key" ON "run_proof_keys"("id", "run_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_key_bound_thumbprint_key" ON "run_proof_keys"("id", "run_id", "attempt", "key_thumbprint");

-- CreateIndex
CREATE UNIQUE INDEX "run_proof_key_bound_pod_key" ON "run_proof_keys"("id", "run_id", "attempt", "workload_kind", "workload_uid", "key_thumbprint", "pod_uid");

-- CreateIndex
CREATE UNIQUE INDEX "run_outbox_events_idempotency_key_key" ON "run_outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "run_outbox_events_published_at_available_at_idx" ON "run_outbox_events"("published_at", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "run_outbox_events_run_id_sequence_key" ON "run_outbox_events"("run_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_dispatched_commands_command_id_key" ON "runtime_dispatched_commands"("command_id");

-- CreateIndex
CREATE INDEX "runtime_dispatched_commands_run_id_attempt_idx" ON "runtime_dispatched_commands"("run_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_dispatched_commands_run_id_attempt_sequence_key" ON "runtime_dispatched_commands"("run_id", "attempt", "sequence");

-- CreateIndex
CREATE INDEX "skills_silo_id_state_idx" ON "skills"("silo_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "skills_id_current_revision_id_key" ON "skills"("id", "current_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_silo_id_owner_principal_id_name_key" ON "skills"("silo_id", "owner_principal_id", "name");

-- CreateIndex
CREATE INDEX "skill_revisions_artifact_revision_id_idx" ON "skill_revisions"("artifact_revision_id");

-- CreateIndex
CREATE INDEX "skill_revisions_state_trust_class_idx" ON "skill_revisions"("state", "trust_class");

-- CreateIndex
CREATE UNIQUE INDEX "skill_revisions_skill_id_revision_key" ON "skill_revisions"("skill_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "skill_revisions_skill_id_id_key" ON "skill_revisions"("skill_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_revisions_id_artifact_revision_id_artifact_content_ad_key" ON "skill_revisions"("id", "artifact_revision_id", "artifact_content_address");

-- CreateIndex
CREATE INDEX "tenant_litellm_keys_tenant_idx" ON "tenant_litellm_keys"("tenant");

-- CreateIndex
CREATE INDEX "tenant_litellm_keys_tenant_revoked_at_idx" ON "tenant_litellm_keys"("tenant", "revoked_at");

-- CreateIndex
CREATE INDEX "token_usage_snapshots_sampled_at_idx" ON "token_usage_snapshots"("sampled_at");

-- CreateIndex
CREATE UNIQUE INDEX "token_usage_snapshots_user_id_currency_key" ON "token_usage_snapshots"("user_id", "currency");

-- AddForeignKey
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_id_active_revision_id_fkey" FOREIGN KEY ("id", "active_revision_id") REFERENCES "agent_revisions"("agent_service_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_agent_service_id_fkey" FOREIGN KEY ("agent_service_id") REFERENCES "agent_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_skill_assignments" ADD CONSTRAINT "agent_revision_skill_assignments_agent_revision_id_fkey" FOREIGN KEY ("agent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_integration_assignments" ADD CONSTRAINT "agent_revision_integration_assignments_agent_revision_id_fkey" FOREIGN KEY ("agent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_integration_assignments" ADD CONSTRAINT "agent_revision_integration_assignments_integration_id_silo_fkey" FOREIGN KEY ("integration_id", "silo_id") REFERENCES "integrations"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_integration_assignments" ADD CONSTRAINT "agent_revision_integration_assignments_custody_reference_i_fkey" FOREIGN KEY ("custody_reference_id", "integration_id", "silo_id") REFERENCES "integration_custody_references"("id", "integration_id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_id_current_revision_id_fkey" FOREIGN KEY ("id", "current_revision_id") REFERENCES "artifact_revisions"("artifact_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_upload_leases" ADD CONSTRAINT "artifact_upload_leases_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_revision_parents" ADD CONSTRAINT "artifact_revision_parents_child_revision_id_fkey" FOREIGN KEY ("child_revision_id") REFERENCES "artifact_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_revision_parents" ADD CONSTRAINT "artifact_revision_parents_parent_revision_id_fkey" FOREIGN KEY ("parent_revision_id") REFERENCES "artifact_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_outbox_events" ADD CONSTRAINT "artifact_outbox_events_artifact_id_revision_id_fkey" FOREIGN KEY ("artifact_id", "revision_id") REFERENCES "artifact_revisions"("artifact_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_fkey" FOREIGN KEY ("tenant") REFERENCES "tenants"("name") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_catalog_id_catalog_revision_catalog_d_fkey" FOREIGN KEY ("catalog_id", "catalog_revision", "catalog_digest") REFERENCES "capability_catalog_revisions"("catalog_id", "revision", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_agent_service_id_agent_revision_i_fkey" FOREIGN KEY ("run_id", "agent_service_id", "agent_revision_id") REFERENCES "agent_runs"("id", "agent_service_id", "agent_revision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_proof_key_id_run_id_attempt_workload_kin_fkey" FOREIGN KEY ("proof_key_id", "run_id", "attempt", "workload_kind", "workload_uid", "proof_key_thumbprint", "pod_uid") REFERENCES "run_proof_keys"("id", "run_id", "attempt", "workload_kind", "workload_uid", "key_thumbprint", "pod_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_attempt_agent_service_id_agent_re_fkey" FOREIGN KEY ("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "workload_audience", "service_account_name", "namespace", "workload_kind", "workload_uid") REFERENCES "workload_assignments"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "audience", "service_account_name", "namespace", "workload_kind", "workload_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_catalog_id_catalog_revision_catalog_dige_fkey" FOREIGN KEY ("catalog_id", "catalog_revision", "catalog_digest") REFERENCES "capability_catalog_revisions"("catalog_id", "revision", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_run_id_agent_service_id_agent_re_fkey" FOREIGN KEY ("run_id", "agent_service_id", "agent_revision_id") REFERENCES "agent_runs"("id", "agent_service_id", "agent_revision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_proof_key_id_run_id_attempt_work_fkey" FOREIGN KEY ("proof_key_id", "run_id", "attempt", "workload_kind", "workload_uid", "proof_key_thumbprint", "pod_uid") REFERENCES "run_proof_keys"("id", "run_id", "attempt", "workload_kind", "workload_uid", "key_thumbprint", "pod_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_catalog_id_catalog_revision_cata_fkey" FOREIGN KEY ("catalog_id", "catalog_revision", "catalog_digest") REFERENCES "capability_catalog_revisions"("catalog_id", "revision", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_run_id_attempt_agent_service_id__fkey" FOREIGN KEY ("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "service_account_name", "namespace", "workload_kind", "workload_uid") REFERENCES "workload_assignments"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "service_account_name", "namespace", "workload_kind", "workload_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participation_events" ADD CONSTRAINT "participation_events_tenant_fkey" FOREIGN KEY ("tenant") REFERENCES "tenants"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_participation" ADD CONSTRAINT "tenant_participation_tenant_fkey" FOREIGN KEY ("tenant") REFERENCES "tenants"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_route_id_silo_id_agent_service_fkey" FOREIGN KEY ("route_id", "silo_id", "agent_service_id", "action") REFERENCES "channel_runtime_routes"("id", "silo_id", "agent_service_id", "action") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_doc_versions" ADD CONSTRAINT "company_doc_versions_company_doc_id_fkey" FOREIGN KEY ("company_doc_id") REFERENCES "company_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_workspace_docs" ADD CONSTRAINT "tenant_workspace_docs_tenant_fkey" FOREIGN KEY ("tenant") REFERENCES "tenants"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_merge_proposals" ADD CONSTRAINT "doc_merge_proposals_tenant_fkey" FOREIGN KEY ("tenant") REFERENCES "tenants"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_id_context_revision_id_fkey" FOREIGN KEY ("id", "context_revision_id") REFERENCES "conversation_context_revisions"("thread_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_context_revisions" ADD CONSTRAINT "conversation_context_revisions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_custody_references" ADD CONSTRAINT "integration_custody_references_integration_id_silo_id_fkey" FOREIGN KEY ("integration_id", "silo_id") REFERENCES "integrations"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "third_party_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_installs" ADD CONSTRAINT "mcp_server_installs_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_access_policies" ADD CONSTRAINT "mcp_server_access_policies_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_access_users" ADD CONSTRAINT "mcp_server_access_users_access_policy_id_fkey" FOREIGN KEY ("access_policy_id") REFERENCES "mcp_server_access_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_grants" ADD CONSTRAINT "mcp_server_grants_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_grants" ADD CONSTRAINT "mcp_server_grants_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_grants" ADD CONSTRAINT "mcp_server_grants_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_credentials" ADD CONSTRAINT "mcp_server_credentials_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_fleet_membership_assertions" ADD CONSTRAINT "verified_fleet_membership_assertions_revision_id_silo_id_fkey" FOREIGN KEY ("revision_id", "silo_id") REFERENCES "verified_fleet_membership_revisions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "highest_accepted_fleet_memberships" ADD CONSTRAINT "highest_accepted_fleet_memberships_revision_id_issuer_id_s_fkey" FOREIGN KEY ("revision_id", "issuer_id", "silo_id", "revision") REFERENCES "verified_fleet_membership_revisions"("id", "issuer_id", "silo_id", "revision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_fact_catalog" ADD CONSTRAINT "memory_fact_catalog_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "memory_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_fact_catalog" ADD CONSTRAINT "memory_fact_catalog_supersedes_fact_id_fkey" FOREIGN KEY ("supersedes_fact_id") REFERENCES "memory_fact_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_outbox_events" ADD CONSTRAINT "memory_outbox_events_fact_id_dataset_id_fkey" FOREIGN KEY ("fact_id", "dataset_id") REFERENCES "memory_fact_catalog"("id", "dataset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_questions" ADD CONSTRAINT "persona_questions_question_set_id_question_set_version_fkey" FOREIGN KEY ("question_set_id", "question_set_version") REFERENCES "persona_question_sets"("question_set_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_profiles" ADD CONSTRAINT "persona_profiles_id_active_revision_id_fkey" FOREIGN KEY ("id", "active_revision_id") REFERENCES "persona_revisions"("persona_profile_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_interviews" ADD CONSTRAINT "persona_interviews_persona_profile_id_user_id_fkey" FOREIGN KEY ("persona_profile_id", "user_id") REFERENCES "persona_profiles"("id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_interviews" ADD CONSTRAINT "persona_interviews_question_set_id_question_set_version_fkey" FOREIGN KEY ("question_set_id", "question_set_version") REFERENCES "persona_question_sets"("question_set_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_interview_answers" ADD CONSTRAINT "persona_interview_answers_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "persona_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_persona_profile_id_fkey" FOREIGN KEY ("persona_profile_id") REFERENCES "persona_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_interview_id_fkey" FOREIGN KEY ("interview_id") REFERENCES "persona_interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_soul_template_id_soul_template_version_fkey" FOREIGN KEY ("soul_template_id", "soul_template_version") REFERENCES "persona_soul_templates"("template_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_previous_revision_id_fkey" FOREIGN KEY ("previous_revision_id") REFERENCES "persona_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_insights" ADD CONSTRAINT "persona_insights_persona_revision_id_fkey" FOREIGN KEY ("persona_revision_id") REFERENCES "persona_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_definitions" ADD CONSTRAINT "model_definitions_provider_credential_id_fkey" FOREIGN KEY ("provider_credential_id") REFERENCES "provider_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_dataset_memberships" ADD CONSTRAINT "tenant_dataset_memberships_tenant_fkey" FOREIGN KEY ("tenant") REFERENCES "tenants"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "third_party_source_items" ADD CONSTRAINT "third_party_source_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "third_party_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_service_id_agent_revision_id_fkey" FOREIGN KEY ("agent_service_id", "agent_revision_id") REFERENCES "agent_revisions"("agent_service_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_service_id_silo_id_fkey" FOREIGN KEY ("agent_service_id", "silo_id") REFERENCES "agent_services"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_input_snapshots" ADD CONSTRAINT "run_input_snapshots_run_id_input_digest_thread_id_silo_id__fkey" FOREIGN KEY ("run_id", "input_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest") REFERENCES "agent_runs"("id", "input_snapshot_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_assignments" ADD CONSTRAINT "workload_assignments_run_id_silo_id_agent_service_id_agent_fkey" FOREIGN KEY ("run_id", "silo_id", "agent_service_id", "agent_revision_id") REFERENCES "agent_runs"("id", "silo_id", "agent_service_id", "agent_revision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_run_id_attempt_agent_service_id_agent__fkey" FOREIGN KEY ("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "audience", "service_account_name", "namespace", "workload_kind", "workload_uid") REFERENCES "workload_assignments"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "audience", "service_account_name", "namespace", "workload_kind", "workload_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_proof_keys" ADD CONSTRAINT "run_proof_keys_run_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_proof_keys" ADD CONSTRAINT "run_proof_keys_assignment_fkey" FOREIGN KEY ("run_id", "attempt", "workload_kind", "workload_uid", "pod_uid") REFERENCES "workload_assignments"("run_id", "attempt", "workload_kind", "workload_uid", "pod_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_proof_keys" ADD CONSTRAINT "run_proof_keys_bootstrap_id_fkey" FOREIGN KEY ("bootstrap_id") REFERENCES "workload_bootstraps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_outbox_events" ADD CONSTRAINT "run_outbox_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_dispatched_commands" ADD CONSTRAINT "runtime_dispatched_commands_run_id_attempt_fkey" FOREIGN KEY ("run_id", "attempt") REFERENCES "runtime_command_streams"("run_id", "attempt") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_id_current_revision_id_fkey" FOREIGN KEY ("id", "current_revision_id") REFERENCES "skill_revisions"("skill_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_litellm_keys" ADD CONSTRAINT "tenant_litellm_keys_tenant_fkey" FOREIGN KEY ("tenant") REFERENCES "tenants"("name") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Null-safe immutable run/snapshot binding. SQL composite FKs alone skip checks when thread_id is NULL.
ALTER TABLE "run_input_snapshots" ADD CONSTRAINT "run_input_snapshots_run_digest_fkey"
    FOREIGN KEY ("run_id", "input_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest")
    REFERENCES "agent_runs"("id", "input_snapshot_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest")
    ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_input_snapshot_fkey"
    FOREIGN KEY ("id", "input_snapshot_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest")
    REFERENCES "run_input_snapshots"("run_id", "input_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest")
    ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "run_input_snapshots" ADD CONSTRAINT "run_input_snapshots_run_input_check" CHECK (
    ("thread_id" IS NULL OR btrim("thread_id") <> '')
    AND btrim("capability_set_digest") <> ''
    AND "capability_set_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof("memory_facts") = 'array'
);

-- Channel-target constraints cannot be represented by Prisma relations/indexes alone.
ALTER TABLE "channel_runtime_routes" ADD CONSTRAINT "channel_runtime_routes_endpoint_nonempty" CHECK (length(btrim("endpoint")) > 0);
ALTER TABLE "channel_runtime_routes" ADD CONSTRAINT "channel_runtime_routes_expiry_after_registration" CHECK ("expires_at" > "registered_at");
ALTER TABLE "channel_runtime_routes" ADD CONSTRAINT "channel_runtime_routes_service_fkey"
    FOREIGN KEY ("agent_service_id", "silo_id") REFERENCES "agent_services"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "channel_runtime_routes_one_current_target"
    ON "channel_runtime_routes"("silo_id", "agent_service_id", "action") WHERE "is_current" = TRUE AND "revoked_at" IS NULL;
CREATE UNIQUE INDEX "agent_runs_channel_context_identity_key"
    ON "agent_runs"("id", "thread_id", "silo_id", "agent_service_id", "delegated_user_id");
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_digest_format" CHECK ("digest" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_membership_revision_positive" CHECK ("membership_revision" > 0);
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_expiry_after_creation" CHECK ("expires_at" > "created_at");
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_action_run_binding" CHECK (("action" = 'command.forward' AND "run_id" IS NOT NULL) OR ("action" = 'events.read' AND "run_id" IS NULL));
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_thread_fkey"
    FOREIGN KEY ("thread_id", "silo_id", "agent_service_id") REFERENCES "conversation_threads"("id", "silo_id", "agent_service_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_participant_fkey"
    FOREIGN KEY ("thread_id", "subject_id") REFERENCES "conversation_participants"("thread_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_run_fkey"
    FOREIGN KEY ("run_id", "thread_id", "silo_id", "agent_service_id", "subject_id") REFERENCES "agent_runs"("id", "thread_id", "silo_id", "agent_service_id", "delegated_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-domain transcript and persona provenance constraints are deliberately database-enforced.
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_agent_service_id_silo_id_fkey"
    FOREIGN KEY ("agent_service_id", "silo_id") REFERENCES "agent_services"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_thread_fkey"
    FOREIGN KEY ("thread_id", "silo_id", "agent_service_id") REFERENCES "conversation_threads"("id", "silo_id", "agent_service_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_run_events" ADD CONSTRAINT "conversation_run_events_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_context_revisions" ADD CONSTRAINT "conversation_context_revisions_through_message_id_fkey"
    FOREIGN KEY ("through_message_id") REFERENCES "conversation_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_context_revisions" ADD CONSTRAINT "conversation_context_revisions_created_by_run_id_fkey"
    FOREIGN KEY ("created_by_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "persona_interview_answers" ADD CONSTRAINT "persona_interview_answers_question_fkey"
    FOREIGN KEY ("question_set_id", "question_set_version", "question_id") REFERENCES "persona_questions"("question_set_id", "question_set_version", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "persona_insights" ADD CONSTRAINT "persona_insights_answer_provenance_fkey"
    FOREIGN KEY ("answer_id", "interview_id", "question_set_id", "question_set_version", "question_id") REFERENCES "persona_interview_answers"("id", "interview_id", "question_set_id", "question_set_version", "question_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_persona_revision_id_fkey"
    FOREIGN KEY ("persona_revision_id") REFERENCES "persona_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL treats NULLs as distinct in ordinary unique indexes; organization-scoped memory needs one canonical null scope.
CREATE UNIQUE INDEX "memory_datasets_exact_scope_key"
    ON "memory_datasets"("silo_id", "scope_kind", "organization_id", COALESCE("scope_resource_id", ''));

-- Projection read models retain their required cardinality and scope guards.
ALTER TABLE "tenant_dataset_memberships" ADD CONSTRAINT "tenant_dataset_memberships_scope_subject_check" CHECK (
    ("scope" IN ('team', 'department', 'project', 'personal') AND LENGTH(BTRIM("subject")) > 0)
    OR ("scope" = 'org' AND "subject" = 'default')
);
CREATE UNIQUE INDEX "model_routing_defaults_global_key"
    ON "model_routing_defaults"("scope") WHERE "cluster_tenant" IS NULL;
CREATE UNIQUE INDEX "org_memberships_one_owner_per_org"
    ON "org_memberships"("cluster_tenant") WHERE "role" = 'owner';

-- Database-native authority guards omitted by Prisma schema diff.

-- Functions
CREATE FUNCTION "enforce_agent_revision_immutability"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."revision" IS DISTINCT FROM OLD."revision"
        OR NEW."digest" IS DISTINCT FROM OLD."digest"
        OR NEW."prompt_policy_version" IS DISTINCT FROM OLD."prompt_policy_version"
        OR NEW."persona_revision_id" IS DISTINCT FROM OLD."persona_revision_id"
        OR NEW."model_policy_id" IS DISTINCT FROM OLD."model_policy_id"
        OR NEW."budget" IS DISTINCT FROM OLD."budget"
        OR NEW."authored_by" IS DISTINCT FROM OLD."authored_by"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'AgentRevision executable fields are immutable';
    END IF;
    IF OLD."state" IN ('rejected', 'retired')
        OR (OLD."state" = 'published' AND NEW."state" NOT IN ('published', 'retired'))
        OR (OLD."state" = 'draft' AND NEW."state" NOT IN ('draft', 'published', 'rejected')) THEN
        RAISE EXCEPTION 'invalid AgentRevision lifecycle transition';
    END IF;
    IF NEW."published_at" IS DISTINCT FROM OLD."published_at"
        AND NOT (
            OLD."state" = 'draft' AND NEW."state" = 'published'
            AND OLD."published_at" IS NULL AND NEW."published_at" IS NOT NULL
        ) THEN
        RAISE EXCEPTION 'AgentRevision publication evidence is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "reject_agent_revision_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'AgentRevision rows cannot be deleted';
END;
$$;
CREATE FUNCTION "enforce_agent_service_lifecycle"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'draft' OR NEW."active_revision_id" IS NOT NULL THEN
            RAISE EXCEPTION 'a new AgentService must begin Draft without an active revision';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'AgentService rows cannot be deleted';
    END IF;
    IF OLD."state" = 'retired' THEN
        RAISE EXCEPTION 'a Retired AgentService is closed and cannot be changed';
    END IF;
    IF NEW."silo_id" IS DISTINCT FROM OLD."silo_id" THEN
        RAISE EXCEPTION 'AgentService silo identity is immutable';
    END IF;
    IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
        (OLD."state" = 'draft' AND NEW."state" IN ('active', 'retired')) OR
        (OLD."state" = 'active' AND NEW."state" IN ('paused', 'retired')) OR
        (OLD."state" = 'paused' AND NEW."state" IN ('active', 'retired'))
    ) THEN
        RAISE EXCEPTION 'invalid AgentService lifecycle transition';
    END IF;
    IF NEW."state" = 'retired' AND NEW."active_revision_id" IS NOT NULL THEN
        RAISE EXCEPTION 'a Retired AgentService cannot retain an active revision';
    END IF;
    IF NEW."active_revision_id" IS DISTINCT FROM OLD."active_revision_id"
        AND NEW."state" NOT IN ('active', 'retired') THEN
        RAISE EXCEPTION 'the active revision pointer changes only on activation, rollover, or retirement';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_agent_service_published_active_revision"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    revision_state "AgentRevisionState";
BEGIN
    IF NEW."active_revision_id" IS NOT NULL THEN
        SELECT "state" INTO revision_state
        FROM "agent_revisions"
        WHERE "id" = NEW."active_revision_id"
          AND "agent_service_id" = NEW."id"
        FOR UPDATE;
        IF revision_state IS DISTINCT FROM 'published'::"AgentRevisionState" THEN
            RAISE EXCEPTION 'AgentService active revision must be a Published revision of the same service';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "protect_active_agent_revision_publication"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."state" <> 'published' AND EXISTS (
        SELECT 1
        FROM "agent_services"
        WHERE "id" = NEW."agent_service_id"
          AND "active_revision_id" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'an active AgentService revision must remain Published';
    END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "enforce_agent_revision_assignment_immutability"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    revision_state "AgentRevisionState";
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT "state" INTO revision_state
        FROM "agent_revisions"
        WHERE "id" = NEW."agent_revision_id"
        FOR UPDATE;
        IF revision_state IS DISTINCT FROM 'draft'::"AgentRevisionState" THEN
            RAISE EXCEPTION 'assignments may be added only to a draft AgentRevision';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'AgentRevision assignments are immutable';
END;
$$;
CREATE FUNCTION "enforce_current_workload_assignment_attempt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    run_state "AgentRunState";
BEGIN
    SELECT "state" INTO run_state
    FROM "agent_runs"
    WHERE "id" = NEW."run_id" AND "attempt" = NEW."attempt"
    FOR UPDATE;
    IF run_state IS DISTINCT FROM 'queued'::"AgentRunState" THEN
        RAISE EXCEPTION 'workload assignment must target the current Queued attempt';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_accepted_outbox_attempt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "agent_runs" WHERE "id" = NEW."run_id" AND "attempt" >= NEW."attempt") THEN
        RAISE EXCEPTION 'outbox event attempt has not been accepted';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "reject_run_input_snapshot_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'RunInputSnapshot rows are immutable';
END;
$$;
CREATE FUNCTION "enforce_initial_agent_run_state"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."attempt" <> 1 OR NEW."state" <> 'accepted'
        OR NEW."started_at" IS NOT NULL OR NEW."finished_at" IS NOT NULL
        OR NEW."terminal_reason" IS NOT NULL OR NEW."cost_amount" IS NOT NULL
        OR NEW."cost_currency" IS NOT NULL THEN
        RAISE EXCEPTION 'a new AgentRun must begin as accepted attempt 1';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_current_agent_run_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    service_state "AgentServiceState";
    service_silo_id TEXT;
    current_revision_id TEXT;
    revision_state "AgentRevisionState";
BEGIN
    SELECT "state", "silo_id", "active_revision_id"
    INTO service_state, service_silo_id, current_revision_id
    FROM "agent_services"
    WHERE "id" = NEW."agent_service_id"
    FOR UPDATE;

    IF service_state IS DISTINCT FROM 'active'::"AgentServiceState"
        OR service_silo_id IS DISTINCT FROM NEW."silo_id"
        OR current_revision_id IS DISTINCT FROM NEW."agent_revision_id" THEN
        RAISE EXCEPTION 'AgentRun requires the exact silo and active revision of an Active AgentService';
    END IF;

    SELECT "state"
    INTO revision_state
    FROM "agent_revisions"
    WHERE "id" = NEW."agent_revision_id"
      AND "agent_service_id" = NEW."agent_service_id"
    FOR UPDATE;

    IF revision_state IS DISTINCT FROM 'published'::"AgentRevisionState" THEN
        RAISE EXCEPTION 'AgentRun requires the exact active revision to remain Published';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_agent_run_authority_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    assignment_exists BOOLEAN;
    attempt_event_claimed_at TIMESTAMP(3);
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
        OR NEW."trigger" IS DISTINCT FROM OLD."trigger"
        OR NEW."delegated_user_id" IS DISTINCT FROM OLD."delegated_user_id"
        OR NEW."request_idempotency_key" IS DISTINCT FROM OLD."request_idempotency_key"
        OR NEW."root_run_id" IS DISTINCT FROM OLD."root_run_id"
        OR NEW."parent_run_id" IS DISTINCT FROM OLD."parent_run_id"
        OR NEW."effective_contract_digest" IS DISTINCT FROM OLD."effective_contract_digest"
        OR NEW."input_snapshot_digest" IS DISTINCT FROM OLD."input_snapshot_digest" THEN
        RAISE EXCEPTION 'AgentRun identity and accepted inputs are immutable';
    END IF;
    IF NEW."attempt" <> OLD."attempt" THEN
        IF NEW."attempt" <> OLD."attempt" + 1 OR OLD."state" NOT IN ('failed', 'cancelled')
            OR NEW."state" <> 'accepted' OR NEW."accepted_at" <= OLD."accepted_at"
            OR NEW."started_at" IS NOT NULL OR NEW."finished_at" IS NOT NULL
            OR NEW."terminal_reason" IS NOT NULL OR NEW."cost_amount" IS NOT NULL
            OR NEW."cost_currency" IS NOT NULL THEN
            RAISE EXCEPTION 'invalid AgentRun attempt transition';
        END IF;
    ELSE
        IF NEW."accepted_at" IS DISTINCT FROM OLD."accepted_at" THEN
            RAISE EXCEPTION 'accepted_at changes only with a new accepted attempt';
        END IF;
        IF OLD."state" IN ('completed', 'failed', 'cancelled') THEN
            RAISE EXCEPTION 'terminal AgentRun attempt coordinates are immutable';
        END IF;
        IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
            (OLD."state" = 'accepted' AND NEW."state" IN ('queued', 'failed', 'cancelling')) OR
            (OLD."state" = 'queued' AND NEW."state" IN ('assigned', 'failed', 'cancelling')) OR
            (OLD."state" = 'assigned' AND NEW."state" IN ('running', 'failed', 'cancelling')) OR
            (OLD."state" = 'running' AND NEW."state" IN ('waiting_for_approval', 'completed', 'failed', 'cancelling')) OR
            (OLD."state" = 'waiting_for_approval' AND NEW."state" IN ('running', 'completed', 'failed', 'cancelling')) OR
            (OLD."state" = 'cancelling' AND NEW."state" = 'cancelled')
        ) THEN
            RAISE EXCEPTION 'invalid AgentRun state transition';
        END IF;
        IF OLD."state" = 'cancelling' AND NEW."state" = 'cancelled' THEN
            PERFORM 1 FROM "workload_assignments" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            PERFORM 1 FROM "run_proof_keys" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            PERFORM 1 FROM "run_outbox_events" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            IF EXISTS (
                SELECT 1 FROM "workload_assignments"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt"
                  AND "state" IN ('pending_pod'::"WorkloadAssignmentState", 'registered'::"WorkloadAssignmentState")
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun requires no current PendingPod or Registered WorkloadAssignment';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "run_proof_keys" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "revoked_at" IS NULL
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun requires every RunProofKey revoked';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM "run_outbox_events"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "kind" = 'run.cancellation_requested'::"RunOutboxEventKind"
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun requires its RunCancellationRequested event';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "run_outbox_events"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt"
                  AND "kind" IN ('run.attempt_requested'::"RunOutboxEventKind", 'run.workload_release_requested'::"RunOutboxEventKind")
                  AND "published_at" IS NULL AND "failed_at" IS NULL
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun requires its attempt and release commands resolved';
            END IF;
            SELECT EXISTS (SELECT 1 FROM "workload_assignments" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt") INTO assignment_exists;
            SELECT "claimed_at" INTO attempt_event_claimed_at
            FROM "run_outbox_events"
            WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "kind" = 'run.attempt_requested'::"RunOutboxEventKind";
            IF (assignment_exists OR attempt_event_claimed_at IS NOT NULL) AND NOT EXISTS (
                SELECT 1 FROM "run_outbox_events"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "kind" = 'run.workload_cleanup_requested'::"RunOutboxEventKind"
                  AND "published_at" IS NOT NULL AND "failed_at" IS NULL
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun with possible physical work requires a confirmed WorkloadCleanup';
            END IF;
        END IF;
        IF OLD."started_at" IS NOT NULL AND NEW."started_at" IS DISTINCT FROM OLD."started_at" THEN
            RAISE EXCEPTION 'AgentRun started_at is immutable once recorded';
        END IF;
        IF OLD."started_at" IS NULL AND NEW."started_at" IS NOT NULL AND NEW."state" <> 'running' THEN
            RAISE EXCEPTION 'AgentRun started_at may be recorded only when entering running';
        END IF;
        IF NEW."state" = 'running' AND NEW."started_at" IS NULL THEN
            RAISE EXCEPTION 'a running AgentRun requires started_at';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_workload_bootstrap_consumption"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    assignment_pod_uid TEXT;
    assignment_state "WorkloadAssignmentState";
    run_state "AgentRunState";
    transition_time TIMESTAMP(3) := clock_timestamp();
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."consumed_at" IS NOT NULL OR NEW."consumed_by_pod_uid" IS NOT NULL OR NEW."receipt_id" IS NOT NULL THEN
            RAISE EXCEPTION 'a new WorkloadBootstrap must begin unconsumed';
        END IF;
        SELECT "state" INTO run_state
        FROM "agent_runs"
        WHERE "id" = NEW."run_id" AND "attempt" = NEW."attempt"
        FOR UPDATE;
        IF run_state IS DISTINCT FROM 'assigned'::"AgentRunState" THEN
            RAISE EXCEPTION 'a new WorkloadBootstrap requires the current Assigned attempt';
        END IF;
        SELECT "state" INTO assignment_state
        FROM "workload_assignments"
        WHERE "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "agent_service_id" = NEW."agent_service_id"
          AND "agent_revision_id" = NEW."agent_revision_id"
          AND "silo_id" = NEW."silo_id" AND "subject_id" = NEW."subject_id"
          AND "audience" = NEW."audience"
          AND "service_account_name" = NEW."service_account_name"
          AND "namespace" = NEW."namespace" AND "workload_kind" = NEW."workload_kind"
          AND "workload_uid" = NEW."workload_uid"
        FOR UPDATE;
        IF assignment_state IS DISTINCT FROM 'pending_pod'::"WorkloadAssignmentState" THEN
            RAISE EXCEPTION 'a new WorkloadBootstrap requires its PendingPod assignment';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WorkloadBootstrap rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
        OR NEW."attempt" IS DISTINCT FROM OLD."attempt"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id"
        OR NEW."audience" IS DISTINCT FROM OLD."audience"
        OR NEW."service_account_name" IS DISTINCT FROM OLD."service_account_name"
        OR NEW."namespace" IS DISTINCT FROM OLD."namespace"
        OR NEW."workload_kind" IS DISTINCT FROM OLD."workload_kind"
        OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid"
        OR NEW."claim_digest" IS DISTINCT FROM OLD."claim_digest"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'WorkloadBootstrap identity is immutable';
    END IF;
    IF OLD."consumed_at" IS NOT NULL OR NEW."consumed_at" IS NULL
        OR NEW."consumed_by_pod_uid" IS NULL OR NEW."receipt_id" IS NULL THEN
        RAISE EXCEPTION 'WorkloadBootstrap may be consumed exactly once';
    END IF;
    IF NEW."consumed_at" < OLD."created_at" OR NEW."consumed_at" > transition_time
        OR NEW."consumed_at" >= OLD."expires_at" OR transition_time >= OLD."expires_at" THEN
        RAISE EXCEPTION 'WorkloadBootstrap must be consumed at a current time before expiry';
    END IF;
    SELECT "state" INTO run_state
    FROM "agent_runs"
    WHERE "id" = NEW."run_id" AND "attempt" = NEW."attempt"
    FOR UPDATE;
    IF run_state IS DISTINCT FROM 'assigned'::"AgentRunState" THEN
        RAISE EXCEPTION 'WorkloadBootstrap consumption requires the current Assigned attempt';
    END IF;
    SELECT "state", "pod_uid" INTO assignment_state, assignment_pod_uid
    FROM "workload_assignments"
    WHERE "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
    FOR UPDATE;
    IF assignment_state IS DISTINCT FROM 'registered'::"WorkloadAssignmentState"
        OR assignment_pod_uid IS DISTINCT FROM NEW."consumed_by_pod_uid" THEN
        RAISE EXCEPTION 'bootstrap consumer Pod is not the registered assignment Pod';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_run_proof_key_bootstrap"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    run_state "AgentRunState";
BEGIN
    SELECT "state" INTO run_state
    FROM "agent_runs"
    WHERE "id" = NEW."run_id" AND "attempt" = NEW."attempt"
    FOR UPDATE;
    IF run_state IS DISTINCT FROM 'assigned'::"AgentRunState" THEN
        RAISE EXCEPTION 'RunProofKey requires the current Assigned attempt';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "workload_bootstraps" WHERE "id" = NEW."bootstrap_id"
        AND "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
        AND "consumed_at" IS NOT NULL AND "consumed_by_pod_uid" = NEW."pod_uid"
    ) THEN
        RAISE EXCEPTION 'RunProofKey requires the consumed bootstrap for the exact run, attempt, and Pod';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_workload_assignment_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    transition_time TIMESTAMP(3) := clock_timestamp();
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'pending_pod' OR NEW."pod_uid" IS NOT NULL
            OR NEW."registered_at" IS NOT NULL OR NEW."revoked_at" IS NOT NULL THEN
            RAISE EXCEPTION 'a new WorkloadAssignment must begin pending_pod';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'WorkloadAssignment rows cannot be deleted'; END IF;
    IF NEW."run_id" IS DISTINCT FROM OLD."run_id" OR NEW."attempt" IS DISTINCT FROM OLD."attempt"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id"
        OR NEW."audience" IS DISTINCT FROM OLD."audience"
        OR NEW."service_account_name" IS DISTINCT FROM OLD."service_account_name"
        OR NEW."namespace" IS DISTINCT FROM OLD."namespace"
        OR NEW."workload_kind" IS DISTINCT FROM OLD."workload_kind"
        OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid"
        OR NEW."workload_profile" IS DISTINCT FROM OLD."workload_profile"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'WorkloadAssignment identity is immutable';
    END IF;
    IF OLD."state" = 'revoked' OR NEW."state" = OLD."state"
        OR (OLD."state" = 'registered' AND NEW."state" <> 'revoked')
        OR (OLD."state" = 'pending_pod' AND NEW."state" NOT IN ('registered', 'revoked')) THEN
        RAISE EXCEPTION 'invalid WorkloadAssignment state transition';
    END IF;
    IF OLD."state" = 'pending_pod' AND NEW."state" = 'registered' AND (
        NEW."pod_uid" IS NULL OR NEW."registered_at" IS NULL OR NEW."revoked_at" IS NOT NULL
        OR NEW."registered_at" < OLD."created_at" OR NEW."registered_at" > transition_time
    ) THEN
        RAISE EXCEPTION 'registration must bind the current Pod and registration time';
    END IF;
    IF OLD."state" = 'pending_pod' AND NEW."state" = 'revoked' AND (
        NEW."pod_uid" IS NOT NULL OR NEW."registered_at" IS NOT NULL OR NEW."revoked_at" IS NULL
        OR NEW."revoked_at" < OLD."created_at" OR NEW."revoked_at" > transition_time
    ) THEN
        RAISE EXCEPTION 'an unregistered WorkloadAssignment must revoke without Pod registration';
    END IF;
    IF OLD."state" = 'registered' AND (
        NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid"
        OR NEW."registered_at" IS DISTINCT FROM OLD."registered_at"
        OR NEW."revoked_at" IS NULL OR NEW."revoked_at" < OLD."registered_at"
        OR NEW."revoked_at" > transition_time
    ) THEN
        RAISE EXCEPTION 'registered WorkloadAssignment Pod UID is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_run_proof_key_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'RunProofKey rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."bootstrap_id" IS DISTINCT FROM OLD."bootstrap_id"
        OR NEW."run_id" IS DISTINCT FROM OLD."run_id" OR NEW."attempt" IS DISTINCT FROM OLD."attempt"
        OR NEW."workload_kind" IS DISTINCT FROM OLD."workload_kind"
        OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid" OR NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid"
        OR NEW."public_key_jwk" IS DISTINCT FROM OLD."public_key_jwk"
        OR NEW."key_thumbprint" IS DISTINCT FROM OLD."key_thumbprint"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'RunProofKey binding is immutable';
    END IF;
    IF OLD."revoked_at" IS NOT NULL OR NEW."revoked_at" IS NULL THEN
        RAISE EXCEPTION 'RunProofKey may be revoked exactly once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_run_outbox_event_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('opencrane.run_outbox_prune', true) IS DISTINCT FROM 'true'
            OR OLD."published_at" IS NULL OR OLD."failed_at" IS NOT NULL THEN
            RAISE EXCEPTION 'OutboxEvent rows cannot be deleted outside successful-delivery retention';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
        OR NEW."attempt" IS DISTINCT FROM OLD."attempt" OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
        OR NEW."kind" IS DISTINCT FROM OLD."kind"
        OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
        OR NEW."payload" IS DISTINCT FROM OLD."payload"
        OR NEW."available_at" IS DISTINCT FROM OLD."available_at"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'OutboxEvent identity, order, and payload are immutable';
    END IF;
    IF OLD."published_at" IS NOT NULL OR OLD."failed_at" IS NOT NULL THEN
        RAISE EXCEPTION 'delivered OutboxEvent status is terminal';
    END IF;
    IF OLD."claimed_at" IS NOT NULL AND (
        NEW."claimed_at" IS NULL OR NEW."claimed_at" < OLD."claimed_at"
    ) THEN
        RAISE EXCEPTION 'OutboxEvent claim time cannot move backward or be erased';
    END IF;
    IF NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" THEN
        IF NEW."claimed_at" IS NULL OR NEW."delivery_count" <> OLD."delivery_count" + 1 THEN
            RAISE EXCEPTION 'each OutboxEvent claim must advance delivery_count exactly once';
        END IF;
    ELSIF NEW."delivery_count" <> OLD."delivery_count" THEN
        RAISE EXCEPTION 'OutboxEvent delivery_count advances only with a new claim';
    END IF;
    IF OLD."published_at" IS NOT NULL AND NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
        RAISE EXCEPTION 'OutboxEvent publication evidence is immutable';
    END IF;
    IF OLD."failed_at" IS NOT NULL AND (
        NEW."failed_at" IS DISTINCT FROM OLD."failed_at"
        OR NEW."failure_code" IS DISTINCT FROM OLD."failure_code"
    ) THEN
        RAISE EXCEPTION 'OutboxEvent failure evidence is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "reject_capability_catalog_revision_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'CapabilityCatalogRevision rows are immutable';
END;
$$;
CREATE FUNCTION "enforce_authorization_grant_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AuthorizationGrant rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id" OR NEW."scope_kind" IS DISTINCT FROM OLD."scope_kind"
        OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id" OR NEW."scope_resource_id" IS DISTINCT FROM OLD."scope_resource_id"
        OR NEW."catalog_id" IS DISTINCT FROM OLD."catalog_id" OR NEW."catalog_revision" IS DISTINCT FROM OLD."catalog_revision"
        OR NEW."catalog_digest" IS DISTINCT FROM OLD."catalog_digest" OR NEW."capability_id" IS DISTINCT FROM OLD."capability_id"
        OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind" OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
        OR NEW."effect" IS DISTINCT FROM OLD."effect" OR NEW."priority" IS DISTINCT FROM OLD."priority"
        OR NEW."valid_from" IS DISTINCT FROM OLD."valid_from" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
        OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'AuthorizationGrant authority fields are immutable';
    END IF;
    IF OLD."revoked_at" IS NOT NULL OR NEW."revoked_at" IS NULL THEN
        RAISE EXCEPTION 'AuthorizationGrant may be revoked exactly once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_approval_request_update"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    decision_time TIMESTAMP(3) := clock_timestamp();
    current_attempt INTEGER;
    current_run_state "AgentRunState";
    assignment_state "WorkloadAssignmentState";
    assignment_expires_at TIMESTAMP(3);
    proof_expires_at TIMESTAMP(3);
    proof_revoked_at TIMESTAMP(3);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'pending' OR NEW."decided_at" IS NOT NULL
            OR NEW."decided_by" IS NOT NULL OR NEW."resume_token_hash" IS NOT NULL THEN
            RAISE EXCEPTION 'a new ApprovalRequest must begin pending';
        END IF;
        IF NEW."created_at" > decision_time OR NEW."expires_at" <= decision_time THEN
            RAISE EXCEPTION 'a new ApprovalRequest must have a current, future expiry';
        END IF;
        SELECT "attempt", "state" INTO current_attempt, current_run_state
        FROM "agent_runs" WHERE "id" = NEW."run_id" FOR UPDATE;
        SELECT "state", "expires_at" INTO assignment_state, assignment_expires_at
        FROM "workload_assignments"
        WHERE "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "agent_service_id" = NEW."agent_service_id" AND "agent_revision_id" = NEW."agent_revision_id"
          AND "silo_id" = NEW."silo_id" AND "subject_id" = NEW."subject_id"
          AND "audience" = NEW."workload_audience" AND "service_account_name" = NEW."service_account_name"
          AND "namespace" = NEW."namespace" AND "workload_kind" = NEW."workload_kind"
          AND "workload_uid" = NEW."workload_uid" AND "pod_uid" = NEW."pod_uid"
        FOR UPDATE;
        SELECT "expires_at", "revoked_at" INTO proof_expires_at, proof_revoked_at
        FROM "run_proof_keys"
        WHERE "id" = NEW."proof_key_id" AND "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "workload_kind" = NEW."workload_kind" AND "workload_uid" = NEW."workload_uid"
          AND "key_thumbprint" = NEW."proof_key_thumbprint" AND "pod_uid" = NEW."pod_uid"
        FOR UPDATE;
        IF current_attempt IS DISTINCT FROM NEW."attempt"
            OR current_run_state IS DISTINCT FROM 'waiting_for_approval'::"AgentRunState"
            OR assignment_state IS DISTINCT FROM 'registered'::"WorkloadAssignmentState"
            OR assignment_expires_at <= decision_time OR proof_revoked_at IS NOT NULL
            OR proof_expires_at <= decision_time THEN
            RAISE EXCEPTION 'ApprovalRequest requires current WaitingForApproval run, assignment, and proof authority';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ApprovalRequest rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
        OR NEW."attempt" IS DISTINCT FROM OLD."attempt" OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."proof_key_id" IS DISTINCT FROM OLD."proof_key_id" OR NEW."proof_key_thumbprint" IS DISTINCT FROM OLD."proof_key_thumbprint"
        OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id" OR NEW."workload_audience" IS DISTINCT FROM OLD."workload_audience"
        OR NEW."service_account_name" IS DISTINCT FROM OLD."service_account_name" OR NEW."namespace" IS DISTINCT FROM OLD."namespace"
        OR NEW."workload_kind" IS DISTINCT FROM OLD."workload_kind" OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid"
        OR NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid" OR NEW."catalog_id" IS DISTINCT FROM OLD."catalog_id"
        OR NEW."catalog_revision" IS DISTINCT FROM OLD."catalog_revision" OR NEW."catalog_digest" IS DISTINCT FROM OLD."catalog_digest"
        OR NEW."capability_id" IS DISTINCT FROM OLD."capability_id" OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind"
        OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id" OR NEW."action" IS DISTINCT FROM OLD."action"
        OR NEW."arguments_digest" IS DISTINCT FROM OLD."arguments_digest" OR NEW."action_digest" IS DISTINCT FROM OLD."action_digest"
        OR NEW."approver_policy_revision" IS DISTINCT FROM OLD."approver_policy_revision"
        OR NEW."effective_policy_digest" IS DISTINCT FROM OLD."effective_policy_digest"
        OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'ApprovalRequest proof and action bindings are immutable';
    END IF;
    IF OLD."state" <> 'pending' OR NEW."state" = 'pending' THEN
        RAISE EXCEPTION 'ApprovalRequest may be decided exactly once';
    END IF;
    IF NEW."state" = 'cancelled' THEN
        IF NEW."decided_at" IS NULL OR NEW."decided_at" > decision_time OR NEW."decided_at" < OLD."created_at" THEN
            RAISE EXCEPTION 'ApprovalRequest cancellation requires a caller-supplied decision time between creation and now';
        END IF;
    ELSE
        NEW."decided_at" := decision_time;
    END IF;
    IF NEW."state" IN ('approved', 'denied') THEN
        SELECT "attempt", "state" INTO current_attempt, current_run_state
        FROM "agent_runs" WHERE "id" = OLD."run_id" FOR UPDATE;
        SELECT "state", "expires_at" INTO assignment_state, assignment_expires_at
        FROM "workload_assignments"
        WHERE "run_id" = OLD."run_id" AND "attempt" = OLD."attempt"
          AND "agent_service_id" = OLD."agent_service_id" AND "agent_revision_id" = OLD."agent_revision_id"
          AND "silo_id" = OLD."silo_id" AND "subject_id" = OLD."subject_id"
          AND "audience" = OLD."workload_audience" AND "service_account_name" = OLD."service_account_name"
          AND "namespace" = OLD."namespace" AND "workload_kind" = OLD."workload_kind"
          AND "workload_uid" = OLD."workload_uid" AND "pod_uid" = OLD."pod_uid"
        FOR UPDATE;
        SELECT "expires_at", "revoked_at" INTO proof_expires_at, proof_revoked_at
        FROM "run_proof_keys" WHERE "id" = OLD."proof_key_id" FOR UPDATE;
        IF current_attempt IS DISTINCT FROM OLD."attempt"
            OR current_run_state IS DISTINCT FROM 'waiting_for_approval'::"AgentRunState"
            OR assignment_state IS DISTINCT FROM 'registered'::"WorkloadAssignmentState"
            OR assignment_expires_at <= decision_time OR proof_revoked_at IS NOT NULL
            OR proof_expires_at <= decision_time THEN
            NEW."state" := 'cancelled';
            NEW."decided_by" := NULL;
            NEW."resume_token_hash" := NULL;
            RETURN NEW;
        END IF;
    END IF;
    IF NEW."state" = 'cancelled' THEN
        NEW."decided_by" := NULL;
        NEW."resume_token_hash" := NULL;
    ELSIF NEW."state" = 'expired' THEN
        IF decision_time < OLD."expires_at" THEN
            RAISE EXCEPTION 'ApprovalRequest may expire only after its deadline';
        END IF;
    ELSIF NEW."state" IN ('approved', 'denied') AND decision_time >= OLD."expires_at" THEN
        RAISE EXCEPTION 'ApprovalRequest decisions must be recorded before expiry';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_action_execution_receipt_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    reservation_time TIMESTAMP(3) := clock_timestamp();
    current_attempt INTEGER;
    current_run_state "AgentRunState";
    assignment_state "WorkloadAssignmentState";
    assignment_expires_at TIMESTAMP(3);
    proof_expires_at TIMESTAMP(3);
    proof_revoked_at TIMESTAMP(3);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'reserved' OR NEW."result" IS NOT NULL
            OR NEW."failure_code" IS NOT NULL OR NEW."completed_at" IS NOT NULL THEN
            RAISE EXCEPTION 'a new ActionExecutionReceipt must begin reserved without a result, failure, or completion';
        END IF;
        SELECT "attempt", "state" INTO current_attempt, current_run_state
        FROM "agent_runs" WHERE "id" = NEW."run_id" FOR UPDATE;
        IF current_attempt IS DISTINCT FROM NEW."attempt"
            OR current_run_state IS DISTINCT FROM 'running'::"AgentRunState" THEN
            RAISE EXCEPTION 'ActionExecutionReceipt requires the current Running AgentRun attempt';
        END IF;
        SELECT "state", "expires_at" INTO assignment_state, assignment_expires_at
        FROM "workload_assignments"
        WHERE "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "agent_service_id" = NEW."agent_service_id" AND "agent_revision_id" = NEW."agent_revision_id"
          AND "silo_id" = NEW."silo_id" AND "subject_id" = NEW."subject_id"
          AND "service_account_name" = NEW."service_account_name" AND "namespace" = NEW."namespace"
          AND "workload_kind" = NEW."workload_kind" AND "workload_uid" = NEW."workload_uid"
          AND "pod_uid" = NEW."pod_uid" FOR UPDATE;
        IF assignment_state IS DISTINCT FROM 'registered'::"WorkloadAssignmentState"
            OR assignment_expires_at <= reservation_time THEN
            RAISE EXCEPTION 'ActionExecutionReceipt requires a current Registered WorkloadAssignment';
        END IF;
        SELECT "expires_at", "revoked_at" INTO proof_expires_at, proof_revoked_at
        FROM "run_proof_keys"
        WHERE "id" = NEW."proof_key_id" AND "run_id" = NEW."run_id" AND "attempt" = NEW."attempt"
          AND "workload_kind" = NEW."workload_kind" AND "workload_uid" = NEW."workload_uid"
          AND "key_thumbprint" = NEW."proof_key_thumbprint" AND "pod_uid" = NEW."pod_uid"
        FOR UPDATE;
        IF proof_revoked_at IS NOT NULL OR proof_expires_at <= reservation_time THEN
            RAISE EXCEPTION 'ActionExecutionReceipt requires a current unrevoked RunProofKey';
        END IF;
        NEW."reserved_at" := reservation_time;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ActionExecutionReceipt rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."subject_id" IS DISTINCT FROM OLD."subject_id" OR NEW."audience" IS DISTINCT FROM OLD."audience"
        OR NEW."service_account_name" IS DISTINCT FROM OLD."service_account_name" OR NEW."namespace" IS DISTINCT FROM OLD."namespace"
        OR NEW."workload_kind" IS DISTINCT FROM OLD."workload_kind" OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid"
        OR NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid" OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
        OR NEW."attempt" IS DISTINCT FROM OLD."attempt" OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id" OR NEW."proof_key_id" IS DISTINCT FROM OLD."proof_key_id"
        OR NEW."proof_key_thumbprint" IS DISTINCT FROM OLD."proof_key_thumbprint" OR NEW."catalog_id" IS DISTINCT FROM OLD."catalog_id"
        OR NEW."catalog_revision" IS DISTINCT FROM OLD."catalog_revision" OR NEW."catalog_digest" IS DISTINCT FROM OLD."catalog_digest"
        OR NEW."capability_id" IS DISTINCT FROM OLD."capability_id" OR NEW."effective_policy_digest" IS DISTINCT FROM OLD."effective_policy_digest"
        OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind" OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
        OR NEW."action" IS DISTINCT FROM OLD."action" OR NEW."arguments_digest" IS DISTINCT FROM OLD."arguments_digest"
        OR NEW."jti" IS DISTINCT FROM OLD."jti" OR NEW."replay_mode" IS DISTINCT FROM OLD."replay_mode"
        OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint" OR NEW."reserved_at" IS DISTINCT FROM OLD."reserved_at" THEN
        RAISE EXCEPTION 'ActionExecutionReceipt request bindings are immutable';
    END IF;
    IF OLD."state" <> 'reserved' OR NEW."state" = 'reserved' THEN
        RAISE EXCEPTION 'ActionExecutionReceipt may complete exactly once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "reject_verified_membership_revision_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'VerifiedFleetMembershipRevision rows are immutable';
END;
$$;
CREATE FUNCTION "reject_verified_membership_assertion_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    assertion_issuer_id TEXT;
    assertion_revision INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT "issuer_id", "revision"
        INTO assertion_issuer_id, assertion_revision
        FROM "verified_fleet_membership_revisions"
        WHERE "id" = NEW."revision_id" AND "silo_id" = NEW."silo_id"
        FOR UPDATE;
        IF assertion_issuer_id IS NULL THEN
            RAISE EXCEPTION 'VerifiedFleetMembershipAssertion requires a verified revision';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM "highest_accepted_fleet_memberships"
            WHERE "issuer_id" = assertion_issuer_id
              AND "silo_id" = NEW."silo_id"
              AND "revision" >= assertion_revision
        ) THEN
            RAISE EXCEPTION 'accepted fleet membership assertions are sealed';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'VerifiedFleetMembershipAssertion rows are immutable';
END;
$$;
CREATE FUNCTION "enforce_highest_membership_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    verified_at TIMESTAMP(3);
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'HighestAcceptedFleetMembership rows cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."issuer_id" IS DISTINCT FROM OLD."issuer_id"
            OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" THEN
            RAISE EXCEPTION 'fleet membership high-watermark key is immutable';
        END IF;
        IF NEW."revision" <= OLD."revision"
            OR NEW."revision_id" IS NOT DISTINCT FROM OLD."revision_id" THEN
            RAISE EXCEPTION 'fleet membership replacement must be a strictly newer verified revision';
        END IF;
        IF NEW."accepted_at" < OLD."accepted_at" THEN
            RAISE EXCEPTION 'fleet membership accepted_at cannot move backward';
        END IF;
    END IF;
    SELECT revision_row."verified_at" INTO verified_at
    FROM "verified_fleet_membership_revisions" AS revision_row
    WHERE revision_row."id" = NEW."revision_id"
      AND revision_row."issuer_id" = NEW."issuer_id"
      AND revision_row."silo_id" = NEW."silo_id"
      AND revision_row."revision" = NEW."revision"
    FOR UPDATE;
    IF verified_at IS NULL OR verified_at > NEW."accepted_at" THEN
        RAISE EXCEPTION 'fleet membership high-watermark requires a verified revision for the same issuer and silo';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "reject_audit_decision_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'AuditDecision rows are append-only';
END;
$$;
CREATE FUNCTION "enforce_conversation_message_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    thread_silo_id TEXT;
    thread_agent_service_id TEXT;
    run_silo_id TEXT;
    run_agent_service_id TEXT;
    run_thread_id TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ConversationMessage rows cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."thread_id" IS DISTINCT FROM OLD."thread_id"
            OR NEW."run_id" IS DISTINCT FROM OLD."run_id" OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
            OR NEW."role" IS DISTINCT FROM OLD."role" OR NEW."source" IS DISTINCT FROM OLD."source"
            OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
            RAISE EXCEPTION 'ConversationMessage identity and provenance are immutable';
        END IF;
        IF OLD."state" IN ('completed', 'failed', 'cancelled') OR NOT (
            (OLD."state" = 'pending' AND NEW."state" IN ('pending', 'streaming', 'completed', 'failed', 'cancelled')) OR
            (OLD."state" = 'streaming' AND NEW."state" IN ('streaming', 'completed', 'failed', 'cancelled'))
        ) THEN
            RAISE EXCEPTION 'invalid ConversationMessage lifecycle transition';
        END IF;
    END IF;
    SELECT "silo_id", "agent_service_id" INTO thread_silo_id, thread_agent_service_id
      FROM "conversation_threads" WHERE "id" = NEW."thread_id" FOR UPDATE;
    IF NEW."source" = 'user_input' THEN
        IF NEW."role" <> 'user' OR NEW."user_id" IS NULL OR NEW."run_id" IS NOT NULL THEN
            RAISE EXCEPTION 'user input requires User role and exact user provenance';
        END IF;
    ELSIF NEW."source" = 'model_output' THEN
        IF NEW."role" <> 'assistant' OR NEW."run_id" IS NULL OR NEW."user_id" IS NOT NULL THEN
            RAISE EXCEPTION 'model output requires Assistant role and exact run provenance';
        END IF;
    ELSIF NEW."source" = 'tool_result' THEN
        IF NEW."role" <> 'tool' OR NEW."run_id" IS NULL OR NEW."user_id" IS NOT NULL THEN
            RAISE EXCEPTION 'tool result requires Tool role and exact run provenance';
        END IF;
    ELSIF NEW."role" <> 'system' OR NEW."user_id" IS NOT NULL THEN
        RAISE EXCEPTION 'platform message requires System role';
    END IF;
    IF NEW."run_id" IS NOT NULL THEN
        SELECT "silo_id", "agent_service_id", "thread_id" INTO run_silo_id, run_agent_service_id, run_thread_id
          FROM "agent_runs" WHERE "id" = NEW."run_id" FOR UPDATE;
        IF run_silo_id IS DISTINCT FROM thread_silo_id OR run_agent_service_id IS DISTINCT FROM thread_agent_service_id
            OR run_thread_id IS DISTINCT FROM NEW."thread_id" THEN
            RAISE EXCEPTION 'ConversationMessage run must belong to the exact thread and silo';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_conversation_run_event_append"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    previous_sequence INTEGER;
    terminal_exists BOOLEAN;
    run_state "AgentRunState";
    run_thread_id TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."run_id", 0));
    SELECT "state", "thread_id" INTO run_state, run_thread_id FROM "agent_runs" WHERE "id" = NEW."run_id" FOR UPDATE;
    IF run_state IS NULL THEN RAISE EXCEPTION 'RunEvent run does not exist'; END IF;
    IF run_thread_id IS NULL THEN RAISE EXCEPTION 'RunEvent requires a conversation-bound AgentRun'; END IF;
    SELECT COALESCE(MAX("sequence"), 0), COALESCE(bool_or("type" IN ('run.completed', 'run.failed', 'run.cancelled')), false)
      INTO previous_sequence, terminal_exists
      FROM "conversation_run_events" WHERE "run_id" = NEW."run_id";
    IF terminal_exists THEN
        RAISE EXCEPTION 'RunEvent stream is terminal';
    END IF;
    IF NEW."sequence" <> previous_sequence + 1 THEN
        RAISE EXCEPTION 'RunEvent sequence must be contiguous';
    END IF;
    IF NEW."type" = 'run.completed' AND run_state <> 'completed' THEN
        RAISE EXCEPTION 'run.completed event requires Completed AgentRun authority';
    ELSIF NEW."type" = 'run.failed' AND run_state <> 'failed' THEN
        RAISE EXCEPTION 'run.failed event requires Failed AgentRun authority';
    ELSIF NEW."type" = 'run.cancelled' AND run_state <> 'cancelled' THEN
        RAISE EXCEPTION 'run.cancelled event requires Cancelled AgentRun authority';
    ELSIF NEW."type" NOT IN ('run.completed', 'run.failed', 'run.cancelled') AND run_state IN ('completed', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'terminal AgentRun accepts only its matching terminal event';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "reject_conversation_immutable_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'canonical conversation history is immutable';
END;
$$;
CREATE FUNCTION "enforce_conversation_context_provenance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    message_thread_id TEXT;
    run_thread_id TEXT;
BEGIN
    SELECT "thread_id" INTO message_thread_id FROM "conversation_messages" WHERE "id" = NEW."through_message_id" FOR UPDATE;
    SELECT "thread_id" INTO run_thread_id FROM "agent_runs" WHERE "id" = NEW."created_by_run_id" FOR UPDATE;
    IF message_thread_id IS DISTINCT FROM NEW."thread_id" OR run_thread_id IS DISTINCT FROM NEW."thread_id" THEN
        RAISE EXCEPTION 'ConversationContextRevision provenance must belong to the exact thread';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_terminal_agent_run_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    expected_type TEXT;
BEGIN
    IF NEW."thread_id" IS NULL OR NEW."state" NOT IN ('completed', 'failed', 'cancelled') THEN RETURN NULL; END IF;
    expected_type := CASE NEW."state" WHEN 'completed' THEN 'run.completed' WHEN 'failed' THEN 'run.failed' ELSE 'run.cancelled' END;
    IF NOT EXISTS (SELECT 1 FROM "conversation_run_events" WHERE "run_id" = NEW."id" AND "type" = expected_type) THEN
        RAISE EXCEPTION 'terminal conversation AgentRun requires its matching terminal RunEvent';
    END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "enforce_persona_question_set_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE missing_count INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PersonaQuestionSet rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' AND NEW."state" <> 'draft' THEN RAISE EXCEPTION 'PersonaQuestionSet must begin as Draft'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD."state" = 'reviewed' THEN RAISE EXCEPTION 'reviewed PersonaQuestionSet is immutable'; END IF;
        IF NEW."question_set_id" IS DISTINCT FROM OLD."question_set_id" OR NEW."version" IS DISTINCT FROM OLD."version"
            OR NEW."created_at" IS DISTINCT FROM OLD."created_at" OR NEW."state" <> 'reviewed' THEN
            RAISE EXCEPTION 'PersonaQuestionSet may only transition from Draft to Reviewed';
        END IF;
    END IF;
    IF NEW."state" = 'reviewed' THEN
        SELECT count(*) INTO missing_count FROM unnest(enum_range(NULL::"PersonaInterviewCategory")) category
          WHERE NOT EXISTS (SELECT 1 FROM "persona_questions" q WHERE q."question_set_id" = NEW."question_set_id" AND q."question_set_version" = NEW."version" AND q."category" = category);
        IF missing_count > 0 THEN RAISE EXCEPTION 'reviewed persona question set must cover every required category'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_persona_question_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE question_set_state "PersonaQuestionSetState";
BEGIN
    IF TG_OP <> 'INSERT' THEN
        SELECT "state" INTO question_set_state FROM "persona_question_sets"
          WHERE "question_set_id" = OLD."question_set_id" AND "version" = OLD."question_set_version" FOR UPDATE;
        IF question_set_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'questions may change only while PersonaQuestionSet is Draft'; END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        SELECT "state" INTO question_set_state FROM "persona_question_sets"
          WHERE "question_set_id" = NEW."question_set_id" AND "version" = NEW."question_set_version" FOR UPDATE;
        IF question_set_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'questions may change only while PersonaQuestionSet is Draft'; END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_persona_interview_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_answers INTEGER; actual_answers INTEGER; question_set_state "PersonaQuestionSetState";
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PersonaInterview rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT "state" INTO question_set_state FROM "persona_question_sets"
          WHERE "question_set_id" = NEW."question_set_id" AND "version" = NEW."question_set_version" FOR UPDATE;
        IF question_set_state IS DISTINCT FROM 'reviewed' THEN RAISE EXCEPTION 'PersonaInterview requires a Reviewed question set'; END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" IN ('completed', 'retaken') THEN RAISE EXCEPTION 'completed PersonaInterview evidence is immutable'; END IF;
    IF NEW."state" = 'completed' THEN
        SELECT count(*) INTO expected_answers FROM "persona_questions" WHERE "question_set_id" = NEW."question_set_id" AND "question_set_version" = NEW."question_set_version";
        SELECT count(*) INTO actual_answers FROM "persona_interview_answers" WHERE "interview_id" = NEW."id";
        IF expected_answers = 0 OR actual_answers <> expected_answers THEN RAISE EXCEPTION 'completed PersonaInterview must answer every reviewed question exactly once'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_persona_answer_provenance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE interview_question_set TEXT; interview_question_version INTEGER; interview_state "PersonaInterviewState";
BEGIN
    SELECT "question_set_id", "question_set_version", "state" INTO interview_question_set, interview_question_version, interview_state
      FROM "persona_interviews" WHERE "id" = NEW."interview_id" FOR UPDATE;
    IF interview_state IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'answers may be added only while PersonaInterview is InProgress'; END IF;
    IF interview_question_set IS DISTINCT FROM NEW."question_set_id" OR interview_question_version IS DISTINCT FROM NEW."question_set_version" THEN
        RAISE EXCEPTION 'PersonaInterviewAnswer must use the exact interview question-set revision';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_persona_insight_provenance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_interview TEXT; revision_state "PersonaRevisionState"; question_category "PersonaInterviewCategory";
BEGIN
    SELECT "interview_id", "state" INTO revision_interview, revision_state FROM "persona_revisions" WHERE "id" = NEW."persona_revision_id" FOR UPDATE;
    IF revision_state IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'insights may be added only while PersonaRevision is Draft'; END IF;
    SELECT "category" INTO question_category FROM "persona_questions"
      WHERE "question_set_id" = NEW."question_set_id" AND "question_set_version" = NEW."question_set_version" AND "question_id" = NEW."question_id";
    IF revision_interview IS DISTINCT FROM NEW."interview_id" OR question_category IS DISTINCT FROM NEW."category" THEN
        RAISE EXCEPTION 'PersonaInsight must match its revision interview and exact question category';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_persona_revision_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    insight_count INTEGER;
    interview_state "PersonaInterviewState";
    interview_profile TEXT;
    template_digest TEXT;
    previous_profile TEXT;
    selected_template_id TEXT;
    selected_template_version INTEGER;
    selected_template_digest TEXT;
    selected_rule_id TEXT;
    expected_answer_ids TEXT[];
BEGIN
    IF TG_OP = 'INSERT' AND NEW."state" <> 'draft' THEN RAISE EXCEPTION 'PersonaRevision must begin as Draft'; END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PersonaRevision rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD."state" = 'approved' THEN RAISE EXCEPTION 'approved PersonaRevision is immutable'; END IF;
        IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."persona_profile_id" IS DISTINCT FROM OLD."persona_profile_id"
            OR NEW."revision" IS DISTINCT FROM OLD."revision" OR NEW."soul_template_id" IS DISTINCT FROM OLD."soul_template_id"
            OR NEW."soul_template_version" IS DISTINCT FROM OLD."soul_template_version" OR NEW."soul_template_digest" IS DISTINCT FROM OLD."soul_template_digest"
            OR NEW."interview_id" IS DISTINCT FROM OLD."interview_id" OR NEW."selection_rule_id" IS DISTINCT FROM OLD."selection_rule_id"
            OR NEW."selection_answer_ids" IS DISTINCT FROM OLD."selection_answer_ids" OR NEW."compiled_instructions" IS DISTINCT FROM OLD."compiled_instructions"
            OR NEW."previous_revision_id" IS DISTINCT FROM OLD."previous_revision_id" OR NEW."authored_by" IS DISTINCT FROM OLD."authored_by"
            OR NEW."created_at" IS DISTINCT FROM OLD."created_at" OR NEW."durable_soul_mutation_policy" IS DISTINCT FROM OLD."durable_soul_mutation_policy" THEN
            RAISE EXCEPTION 'PersonaRevision content is immutable; edits create a new revision';
        END IF;
    END IF;
    IF NEW."previous_revision_id" IS NOT NULL THEN
        SELECT "persona_profile_id" INTO previous_profile FROM "persona_revisions" WHERE "id" = NEW."previous_revision_id" FOR UPDATE;
        IF previous_profile IS DISTINCT FROM NEW."persona_profile_id" THEN RAISE EXCEPTION 'PersonaRevision history must stay inside one profile'; END IF;
    END IF;
    IF NEW."state" = 'approved' THEN
        SELECT "state", "persona_profile_id" INTO interview_state, interview_profile FROM "persona_interviews" WHERE "id" = NEW."interview_id" FOR UPDATE;
        SELECT "digest" INTO template_digest FROM "persona_soul_templates" WHERE "template_id" = NEW."soul_template_id" AND "version" = NEW."soul_template_version";
        SELECT count(*) INTO insight_count FROM "persona_insights" WHERE "persona_revision_id" = NEW."id";
        IF interview_state IS DISTINCT FROM 'completed' OR interview_profile IS DISTINCT FROM NEW."persona_profile_id" OR template_digest IS DISTINCT FROM NEW."soul_template_digest" OR insight_count < 3 OR insight_count > 5 THEN
            RAISE EXCEPTION 'PersonaRevision approval requires completed matching interview, exact template digest, and three to five insights';
        END IF;
        SELECT candidate."template_id", candidate."version", candidate."digest", candidate."rule_id", candidate."answer_ids"
          INTO selected_template_id, selected_template_version, selected_template_digest, selected_rule_id, expected_answer_ids
          FROM (
            SELECT template."template_id", template."version", template."digest", rule ->> 'id' AS "rule_id",
                ARRAY(
                    SELECT answer."id" FROM jsonb_object_keys(rule -> 'answers') required_question_id
                    JOIN "persona_interview_answers" answer ON answer."interview_id" = NEW."interview_id"
                        AND answer."question_id" = required_question_id
                    ORDER BY answer."id"
                ) AS "answer_ids",
                (rule ->> 'priority')::INTEGER AS "priority"
            FROM "persona_soul_templates" template
            CROSS JOIN LATERAL jsonb_array_elements(template."selection_rules") rule
            WHERE NOT EXISTS (
                SELECT 1 FROM jsonb_each_text(rule -> 'answers') required_answer
                WHERE NOT EXISTS (
                    SELECT 1 FROM "persona_interview_answers" answer
                    WHERE answer."interview_id" = NEW."interview_id"
                      AND answer."question_id" = required_answer.key AND answer."value" = required_answer.value
                )
            )
            ORDER BY "priority" DESC, template."template_id", template."version" DESC, "rule_id"
            LIMIT 1
          ) candidate;
        IF selected_template_id IS DISTINCT FROM NEW."soul_template_id"
            OR selected_template_version IS DISTINCT FROM NEW."soul_template_version"
            OR selected_template_digest IS DISTINCT FROM NEW."soul_template_digest"
            OR selected_rule_id IS DISTINCT FROM NEW."selection_rule_id"
            OR expected_answer_ids IS DISTINCT FROM ARRAY(SELECT answer_id FROM unnest(NEW."selection_answer_ids") answer_id ORDER BY answer_id) THEN
            RAISE EXCEPTION 'PersonaRevision must pin the deterministic answer-selected SOUL template and exact answer evidence';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_persona_soul_template_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rule_count INTEGER; rule_id_count INTEGER;
BEGIN
    IF jsonb_array_length(NEW."selection_rules") = 0 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW."selection_rules") rule
        WHERE jsonb_typeof(rule) <> 'object' OR btrim(COALESCE(rule ->> 'id', '')) = ''
          OR COALESCE(rule ->> 'priority', '') !~ '^-?[0-9]+$'
          OR CASE WHEN jsonb_typeof(rule -> 'answers') = 'object'
              THEN NOT EXISTS (SELECT 1 FROM jsonb_object_keys(rule -> 'answers')) ELSE true END
    ) THEN RAISE EXCEPTION 'SOUL template selection rules require id, integer priority, and exact answer matches'; END IF;
    SELECT count(*), count(DISTINCT rule ->> 'id') INTO rule_count, rule_id_count FROM jsonb_array_elements(NEW."selection_rules") rule;
    IF rule_count <> rule_id_count THEN RAISE EXCEPTION 'SOUL template selection rule identifiers must be unique'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "reject_persona_source_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reviewed persona source is immutable'; END; $$;
CREATE FUNCTION "enforce_personal_agent_persona"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE service_kind "AgentServiceKind"; service_silo_id TEXT; persona_state "PersonaRevisionState"; persona_silo_id TEXT;
BEGIN
    IF NEW."state" = 'published' THEN
        SELECT "kind", "silo_id" INTO service_kind, service_silo_id FROM "agent_services" WHERE "id" = NEW."agent_service_id" FOR UPDATE;
        IF service_kind = 'personal' THEN
            SELECT revision."state", profile."silo_id" INTO persona_state, persona_silo_id
              FROM "persona_revisions" revision JOIN "persona_profiles" profile ON profile."id" = revision."persona_profile_id"
              WHERE revision."id" = NEW."persona_revision_id";
            IF NEW."persona_revision_id" IS NULL OR persona_state IS DISTINCT FROM 'approved' OR persona_silo_id IS DISTINCT FROM service_silo_id THEN
                RAISE EXCEPTION 'personal AgentRevision requires an approved PersonaRevision in the same silo';
            END IF;
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "enforce_active_persona_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_state "PersonaRevisionState";
BEGIN
    IF NEW."active_revision_id" IS NULL THEN RETURN NEW; END IF;
    SELECT "state" INTO revision_state FROM "persona_revisions"
      WHERE "id" = NEW."active_revision_id" AND "persona_profile_id" = NEW."id" FOR UPDATE;
    IF revision_state IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'active PersonaRevision must be Approved'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_artifact_revision_silo_provenance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_silo_id TEXT; source_silo_id TEXT;
BEGIN
    SELECT "silo_id" INTO artifact_silo_id FROM "artifacts" WHERE "id" = NEW."artifact_id" FOR UPDATE;
    IF NEW."source_run_id" IS NOT NULL THEN
        SELECT "silo_id" INTO source_silo_id FROM "agent_runs" WHERE "id" = NEW."source_run_id" FOR UPDATE;
        IF source_silo_id IS DISTINCT FROM artifact_silo_id THEN RAISE EXCEPTION 'ArtifactRevision run provenance must stay inside its silo'; END IF;
    END IF;
    IF NEW."source_message_id" IS NOT NULL THEN
        SELECT thread."silo_id" INTO source_silo_id FROM "conversation_messages" message
          JOIN "conversation_threads" thread ON thread."id" = message."thread_id"
          WHERE message."id" = NEW."source_message_id" FOR UPDATE OF message, thread;
        IF source_silo_id IS DISTINCT FROM artifact_silo_id THEN RAISE EXCEPTION 'ArtifactRevision message provenance must stay inside its silo'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_artifact_revision_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW."state" <> 'published' THEN RAISE EXCEPTION 'ArtifactRevision becomes visible only through finalization'; END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ArtifactRevision metadata cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."artifact_id" IS DISTINCT FROM OLD."artifact_id" OR NEW."revision" IS DISTINCT FROM OLD."revision"
            OR NEW."content_address" IS DISTINCT FROM OLD."content_address" OR NEW."byte_length" IS DISTINCT FROM OLD."byte_length"
            OR NEW."media_type" IS DISTINCT FROM OLD."media_type" OR NEW."provenance" IS DISTINCT FROM OLD."provenance"
            OR NEW."source_run_id" IS DISTINCT FROM OLD."source_run_id" OR NEW."source_message_id" IS DISTINCT FROM OLD."source_message_id"
            OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
            RAISE EXCEPTION 'ArtifactRevision content and provenance are immutable';
        END IF;
        IF NOT ((OLD."state" = 'published' AND NEW."state" IN ('published', 'deletion_pending')) OR (OLD."state" = 'deletion_pending' AND NEW."state" IN ('deletion_pending', 'purged')) OR (OLD."state" = 'purged' AND NEW."state" = 'purged')) THEN
            RAISE EXCEPTION 'invalid ArtifactRevision lifecycle transition';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_artifact_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_state "ArtifactRevisionState";
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Artifact rows use authorized deletion lifecycle'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."owner_principal_id" IS DISTINCT FROM OLD."owner_principal_id" OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."retention_policy" IS DISTINCT FROM OLD."retention_policy" OR NEW."created_at" IS DISTINCT FROM OLD."created_at") THEN RAISE EXCEPTION 'Artifact identity and retention are immutable'; END IF;
    IF TG_OP = 'UPDATE' AND NOT ((OLD."state" = 'active' AND NEW."state" IN ('active', 'deletion_pending')) OR (OLD."state" = 'deletion_pending' AND NEW."state" IN ('deletion_pending', 'deleted')) OR (OLD."state" = 'deleted' AND NEW."state" = 'deleted')) THEN RAISE EXCEPTION 'invalid Artifact lifecycle transition'; END IF;
    IF NEW."current_revision_id" IS NOT NULL THEN
        SELECT "state" INTO revision_state FROM "artifact_revisions" WHERE "id" = NEW."current_revision_id" AND "artifact_id" = NEW."id" FOR UPDATE;
        IF revision_state IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'current Artifact revision must be Published'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "protect_current_artifact_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."state" <> 'published' AND EXISTS (SELECT 1 FROM "artifacts" WHERE "id" = NEW."artifact_id" AND "current_revision_id" = NEW."id") THEN RAISE EXCEPTION 'current ArtifactRevision must remain Published'; END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "reject_artifact_parent_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ArtifactRevision lineage is immutable'; END; $$;
CREATE FUNCTION "enforce_artifact_parent_silo"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE child_silo_id TEXT; parent_silo_id TEXT;
BEGIN
    SELECT artifact."silo_id" INTO child_silo_id FROM "artifact_revisions" revision
      JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id" WHERE revision."id" = NEW."child_revision_id" FOR UPDATE OF revision, artifact;
    SELECT artifact."silo_id" INTO parent_silo_id FROM "artifact_revisions" revision
      JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id" WHERE revision."id" = NEW."parent_revision_id" FOR UPDATE OF revision, artifact;
    IF child_silo_id IS DISTINCT FROM parent_silo_id THEN RAISE EXCEPTION 'ArtifactRevision lineage cannot cross silos'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_skill_revision_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_address TEXT; artifact_state "ArtifactRevisionState"; skill_silo_id TEXT; artifact_silo_id TEXT;
BEGIN
    IF TG_OP = 'INSERT' AND NEW."state" <> 'draft' THEN RAISE EXCEPTION 'SkillRevision must begin as Draft'; END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SkillRevision rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."skill_id" IS DISTINCT FROM OLD."skill_id" OR NEW."revision" IS DISTINCT FROM OLD."revision"
            OR NEW."artifact_id" IS DISTINCT FROM OLD."artifact_id" OR NEW."artifact_revision_id" IS DISTINCT FROM OLD."artifact_revision_id"
            OR NEW."artifact_content_address" IS DISTINCT FROM OLD."artifact_content_address" OR NEW."manifest" IS DISTINCT FROM OLD."manifest"
            OR NEW."requirements" IS DISTINCT FROM OLD."requirements" OR NEW."trust_class" IS DISTINCT FROM OLD."trust_class"
            OR NEW."authored_by" IS DISTINCT FROM OLD."authored_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
            RAISE EXCEPTION 'SkillRevision content is immutable; changes create a new revision';
        END IF;
        IF OLD."state" IN ('published', 'revoked') AND (
            NEW."test_report" IS DISTINCT FROM OLD."test_report" OR NEW."scan_result" IS DISTINCT FROM OLD."scan_result"
            OR NEW."signature" IS DISTINCT FROM OLD."signature" OR NEW."signer_key_id" IS DISTINCT FROM OLD."signer_key_id"
            OR NEW."reviewed_by" IS DISTINCT FROM OLD."reviewed_by" OR NEW."published_at" IS DISTINCT FROM OLD."published_at") THEN
            RAISE EXCEPTION 'published SkillRevision review and signature evidence is immutable';
        END IF;
        IF NOT ((OLD."state" = 'draft' AND NEW."state" IN ('draft', 'review', 'rejected')) OR (OLD."state" = 'review' AND NEW."state" IN ('review', 'published', 'rejected')) OR (OLD."state" = 'published' AND NEW."state" IN ('published', 'revoked')) OR (OLD."state" IN ('rejected', 'revoked') AND NEW."state" = OLD."state")) THEN RAISE EXCEPTION 'invalid SkillRevision lifecycle transition'; END IF;
    END IF;
    SELECT "silo_id" INTO skill_silo_id FROM "skills" WHERE "id" = NEW."skill_id" FOR UPDATE;
    SELECT artifact."silo_id" INTO artifact_silo_id FROM "artifact_revisions" revision
      JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id"
      WHERE revision."id" = NEW."artifact_revision_id" AND revision."artifact_id" = NEW."artifact_id" FOR UPDATE OF revision, artifact;
    IF skill_silo_id IS DISTINCT FROM artifact_silo_id THEN RAISE EXCEPTION 'SkillRevision ArtifactRevision must stay inside the Skill silo'; END IF;
    IF NEW."state" = 'published' THEN
        SELECT "content_address", "state" INTO artifact_address, artifact_state FROM "artifact_revisions" WHERE "id" = NEW."artifact_revision_id" AND "artifact_id" = NEW."artifact_id" FOR UPDATE;
        IF artifact_address IS DISTINCT FROM NEW."artifact_content_address" OR artifact_state IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'SkillRevision must pin an exact published ArtifactRevision'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_skill_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Skill rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
            OR NEW."owner_principal_id" IS DISTINCT FROM OLD."owner_principal_id" OR NEW."name" IS DISTINCT FROM OLD."name"
            OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN RAISE EXCEPTION 'Skill identity is immutable'; END IF;
        IF NOT ((OLD."state" = 'active' AND NEW."state" IN ('active', 'retired')) OR (OLD."state" = 'retired' AND NEW."state" = 'retired')) THEN
            RAISE EXCEPTION 'invalid Skill lifecycle transition';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_current_skill_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_state "SkillRevisionState";
BEGIN
    IF NEW."current_revision_id" IS NOT NULL THEN
        SELECT "state" INTO revision_state FROM "skill_revisions" WHERE "id" = NEW."current_revision_id" AND "skill_id" = NEW."id" FOR UPDATE;
        IF revision_state IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'current Skill revision must be Published'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "protect_assigned_skill_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."state" <> 'published' AND EXISTS (SELECT 1 FROM "agent_revision_skill_assignments" WHERE "skill_revision_id" = NEW."id") THEN RAISE EXCEPTION 'assigned SkillRevision must remain Published'; END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "protect_skill_artifact_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."state" <> 'published' AND EXISTS (
        SELECT 1 FROM "skill_revisions" revision
        WHERE revision."artifact_revision_id" = NEW."id" AND revision."artifact_id" = NEW."artifact_id"
          AND (revision."state" = 'published' OR EXISTS (
              SELECT 1 FROM "agent_revision_skill_assignments" assignment WHERE assignment."skill_revision_id" = revision."id"
          ))
    ) THEN RAISE EXCEPTION 'published or assigned SkillRevision keeps its ArtifactRevision Published'; END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "enforce_agent_skill_assignment_silo"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agent_silo_id TEXT; skill_silo_id TEXT; skill_revision_state "SkillRevisionState";
BEGIN
    SELECT service."silo_id" INTO agent_silo_id FROM "agent_revisions" revision
      JOIN "agent_services" service ON service."id" = revision."agent_service_id"
      WHERE revision."id" = NEW."agent_revision_id" FOR UPDATE OF revision, service;
    SELECT skill."silo_id", revision."state" INTO skill_silo_id, skill_revision_state
      FROM "skill_revisions" revision JOIN "skills" skill ON skill."id" = revision."skill_id"
      WHERE revision."id" = NEW."skill_revision_id" AND revision."skill_id" = NEW."skill_id" FOR UPDATE OF revision, skill;
    IF agent_silo_id IS DISTINCT FROM skill_silo_id OR skill_revision_state IS DISTINCT FROM 'published' THEN
        RAISE EXCEPTION 'AgentRevision may assign only a Published SkillRevision from the same silo';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_memory_dataset_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MemoryDataset catalog rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."scope_kind" IS DISTINCT FROM OLD."scope_kind" OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id" OR NEW."scope_resource_id" IS DISTINCT FROM OLD."scope_resource_id" OR NEW."cognee_dataset_id" IS DISTINCT FROM OLD."cognee_dataset_id" OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at") THEN RAISE EXCEPTION 'MemoryDataset authority is immutable'; END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'retired' THEN RAISE EXCEPTION 'retired MemoryDataset is closed'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_memory_fact_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior_dataset TEXT; prior_state "MemoryFactState"; dataset_silo_id TEXT; source_silo_id TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'active' THEN RAISE EXCEPTION 'MemoryFact catalog entry must begin Active'; END IF;
        SELECT "silo_id" INTO dataset_silo_id FROM "memory_datasets" WHERE "id" = NEW."dataset_id" AND "state" = 'active' FOR UPDATE;
        IF dataset_silo_id IS NULL THEN RAISE EXCEPTION 'MemoryFact requires an active MemoryDataset'; END IF;
        IF NEW."source_artifact_revision_id" IS NOT NULL THEN
            SELECT artifact."silo_id" INTO source_silo_id FROM "artifact_revisions" revision
              JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id"
              WHERE revision."id" = NEW."source_artifact_revision_id" FOR UPDATE OF revision, artifact;
        ELSIF NEW."source_message_id" IS NOT NULL THEN
            SELECT thread."silo_id" INTO source_silo_id FROM "conversation_messages" message
              JOIN "conversation_threads" thread ON thread."id" = message."thread_id"
              WHERE message."id" = NEW."source_message_id" FOR UPDATE OF message, thread;
        ELSE
            source_silo_id := dataset_silo_id;
        END IF;
        IF source_silo_id IS DISTINCT FROM dataset_silo_id THEN RAISE EXCEPTION 'MemoryFact provenance must stay inside its dataset silo'; END IF;
        IF NEW."supersedes_fact_id" IS NOT NULL THEN
            SELECT "dataset_id", "state" INTO prior_dataset, prior_state FROM "memory_fact_catalog" WHERE "id" = NEW."supersedes_fact_id" FOR UPDATE;
            IF prior_dataset IS DISTINCT FROM NEW."dataset_id" OR prior_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'memory correction must supersede an active fact in the same dataset'; END IF;
            UPDATE "memory_fact_catalog" SET "state" = 'corrected', "corrected_at" = clock_timestamp() WHERE "id" = NEW."supersedes_fact_id";
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MemoryFact catalog rows use explicit forget lifecycle'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."dataset_id" IS DISTINCT FROM OLD."dataset_id" OR NEW."cognee_external_id" IS DISTINCT FROM OLD."cognee_external_id" OR NEW."content_digest" IS DISTINCT FROM OLD."content_digest" OR NEW."consent_state" IS DISTINCT FROM OLD."consent_state" OR NEW."sensitivity" IS DISTINCT FROM OLD."sensitivity" OR NEW."provenance" IS DISTINCT FROM OLD."provenance" OR NEW."source_artifact_revision_id" IS DISTINCT FROM OLD."source_artifact_revision_id" OR NEW."source_message_id" IS DISTINCT FROM OLD."source_message_id" OR NEW."supersedes_fact_id" IS DISTINCT FROM OLD."supersedes_fact_id" OR NEW."recorded_by" IS DISTINCT FROM OLD."recorded_by" OR NEW."recorded_at" IS DISTINCT FROM OLD."recorded_at" THEN RAISE EXCEPTION 'MemoryFact content and provenance are immutable'; END IF;
    IF OLD."corrected_at" IS NOT NULL AND NEW."corrected_at" IS DISTINCT FROM OLD."corrected_at" THEN RAISE EXCEPTION 'MemoryFact correction evidence is immutable'; END IF;
    IF NOT ((OLD."state" = 'active' AND NEW."state" IN ('active', 'corrected', 'forget_pending'))
        OR (OLD."state" = 'corrected' AND NEW."state" IN ('corrected', 'forget_pending'))
        OR (OLD."state" = 'forget_pending' AND NEW."state" IN ('forget_pending', 'forgotten'))
        OR (OLD."state" = 'forgotten' AND NEW."state" = 'forgotten')) THEN RAISE EXCEPTION 'invalid MemoryFact forget lifecycle'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_corrected_memory_successor"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."state" = 'corrected' AND NOT EXISTS (
        SELECT 1 FROM "memory_fact_catalog" successor WHERE successor."supersedes_fact_id" = NEW."id"
    ) THEN RAISE EXCEPTION 'Corrected MemoryFact requires exactly one committed successor'; END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION "enforce_artifact_upload_lease_silo_and_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_silo_id TEXT;
BEGIN
    SELECT "silo_id" INTO artifact_silo_id FROM "artifacts" WHERE "id" = NEW."artifact_id" FOR UPDATE;
    IF artifact_silo_id IS DISTINCT FROM NEW."silo_id" THEN RAISE EXCEPTION 'ArtifactUploadLease must stay inside its Artifact silo'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."artifact_id" IS DISTINCT FROM OLD."artifact_id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."capability_jti" IS DISTINCT FROM OLD."capability_jti" OR NEW."expected_content_address" IS DISTINCT FROM OLD."expected_content_address" OR NEW."expected_byte_length" IS DISTINCT FROM OLD."expected_byte_length" OR NEW."media_type" IS DISTINCT FROM OLD."media_type" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at") THEN RAISE EXCEPTION 'ArtifactUploadLease authority coordinates are immutable'; END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" <> 'active' AND (NEW."promotion_receipt_digest" IS DISTINCT FROM OLD."promotion_receipt_digest" OR NEW."promoted_content_address" IS DISTINCT FROM OLD."promoted_content_address" OR NEW."promoted_byte_length" IS DISTINCT FROM OLD."promoted_byte_length" OR NEW."promoted_at" IS DISTINCT FROM OLD."promoted_at") THEN RAISE EXCEPTION 'ArtifactUploadLease promotion receipt is immutable'; END IF;
    IF TG_OP = 'UPDATE' AND NOT ((OLD."state" = 'active' AND NEW."state" IN ('active', 'promoted', 'expired', 'cancelled')) OR (OLD."state" = 'promoted' AND NEW."state" IN ('promoted', 'finalized', 'expired', 'cancelled')) OR (OLD."state" = 'finalized' AND NEW."state" = 'finalized') OR (OLD."state" IN ('expired', 'cancelled') AND NEW."state" = OLD."state")) THEN RAISE EXCEPTION 'invalid ArtifactUploadLease lifecycle transition'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION "has_nonempty_distinct_tool_ids"(TEXT[]) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    cardinality($1) > 0 AND NOT EXISTS (
      SELECT 1
      FROM unnest($1) AS tool("value")
      GROUP BY tool."value"
      HAVING tool."value" IS NULL OR btrim(tool."value") = '' OR count(*) > 1
    ),
    FALSE
  );
$$;
CREATE FUNCTION "enforce_integration_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'active' THEN RAISE EXCEPTION 'a new Integration must begin Active'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Integration rows cannot be deleted'; END IF;
  IF OLD."state" = 'retired' THEN RAISE EXCEPTION 'a Retired Integration is closed'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
    OR NEW."obot_catalog_entry_id" IS DISTINCT FROM OLD."obot_catalog_entry_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Integration identity is immutable';
  END IF;
  IF NEW."state" NOT IN ('active', 'retired') THEN RAISE EXCEPTION 'invalid Integration lifecycle transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_integration_custody_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" = 'ready' AND NEW."expires_at" <= NEW."created_at" THEN
      RAISE EXCEPTION 'a Ready custody reference must expire after creation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Integration custody references cannot be deleted'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."integration_id" IS DISTINCT FROM OLD."integration_id"
    OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."obot_custody_reference" IS DISTINCT FROM OLD."obot_custody_reference"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Integration custody identity is immutable';
  END IF;
  IF OLD."state" <> 'ready' OR NEW."state" NOT IN ('ready', 'revoked', 'expired') THEN
    RAISE EXCEPTION 'invalid Integration custody lifecycle transition';
  END IF;
  IF NEW."state" = 'expired' AND NEW."expires_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'a custody reference expires only after its expiry instant';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_agent_revision_integration_assignment_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agent_silo_id TEXT; integration_state "IntegrationState"; custody_state "IntegrationCustodyState"; custody_expiry TIMESTAMP(3); custody_revoked_at TIMESTAMP(3);
BEGIN
  SELECT service."silo_id" INTO agent_silo_id
    FROM "agent_revisions" revision JOIN "agent_services" service ON service."id" = revision."agent_service_id"
    WHERE revision."id" = NEW."agent_revision_id" FOR UPDATE OF revision, service;
  SELECT integration."state" INTO integration_state FROM "integrations" integration
    WHERE integration."id" = NEW."integration_id" AND integration."silo_id" = NEW."silo_id" FOR UPDATE;
  SELECT custody."state", custody."expires_at", custody."revoked_at"
    INTO custody_state, custody_expiry, custody_revoked_at FROM "integration_custody_references" custody
    WHERE custody."id" = NEW."custody_reference_id" AND custody."integration_id" = NEW."integration_id" AND custody."silo_id" = NEW."silo_id" FOR UPDATE;
  IF agent_silo_id IS DISTINCT FROM NEW."silo_id" OR integration_state IS DISTINCT FROM 'active'::"IntegrationState" THEN
    RAISE EXCEPTION 'AgentRevision may assign only an Active Integration from the same silo';
  END IF;
  IF custody_state IS DISTINCT FROM 'ready'::"IntegrationCustodyState" OR custody_revoked_at IS NOT NULL OR custody_expiry <= clock_timestamp() THEN
    RAISE EXCEPTION 'AgentRevision may assign only a ready unexpired Integration custody reference';
  END IF;
  RETURN NEW;
END;
$$;

-- Check constraints
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_nonempty_check" CHECK (
        btrim("silo_id") <> '' AND btrim("name") <> '' AND
        btrim("owner_subject_id") <> '' AND btrim("workload_profile") <> ''
    );
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_personal_owner_check" CHECK (
        "kind" <> 'personal' OR "owner_scope" IN ('personal', 'user')
    );
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_active_revision_check" CHECK (
        "state" <> 'active' OR "active_revision_id" IS NOT NULL
    );
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_revision_check" CHECK ("revision" > 0);
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_nonempty_check" CHECK (
        btrim("agent_service_id") <> '' AND btrim("digest") <> '' AND
        btrim("prompt_policy_version") <> '' AND btrim("model_policy_id") <> '' AND
        btrim("authored_by") <> '' AND "digest" ~ '^sha256:[0-9a-f]{64}$'
    );
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_publication_check" CHECK (
        ("state" = 'published' AND "published_at" IS NOT NULL) OR
        ("state" = 'retired' AND "published_at" IS NOT NULL) OR
        ("state" IN ('draft', 'rejected') AND "published_at" IS NULL)
    );
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_attempt_check" CHECK ("attempt" > 0);
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_nonempty_check" CHECK (
        btrim("silo_id") <> '' AND btrim("agent_service_id") <> '' AND
        btrim("agent_revision_id") <> '' AND btrim("request_idempotency_key") <> '' AND
        btrim("root_run_id") <> '' AND btrim("effective_contract_digest") <> '' AND
        btrim("input_snapshot_digest") <> '' AND
        "effective_contract_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        "input_snapshot_digest" ~ '^sha256:[0-9a-f]{64}$'
    );
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_terminal_check" CHECK (
        ("state" IN ('completed', 'failed', 'cancelled') AND "finished_at" IS NOT NULL AND "terminal_reason" IS NOT NULL) OR
        ("state" NOT IN ('completed', 'failed', 'cancelled') AND "finished_at" IS NULL AND "terminal_reason" IS NULL)
    );
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_terminal_reason_check" CHECK (
        ("state" = 'completed' AND "terminal_reason" = 'success') OR
        ("state" = 'cancelled' AND "terminal_reason" = 'user_cancelled') OR
        ("state" = 'failed' AND "terminal_reason" NOT IN ('success', 'user_cancelled')) OR
        "state" NOT IN ('completed', 'failed', 'cancelled')
    );
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_cost_check" CHECK (
        ("cost_amount" IS NULL AND "cost_currency" IS NULL) OR
        ("cost_amount" IS NOT NULL AND "cost_amount" >= 0 AND "cost_currency" IS NOT NULL AND btrim("cost_currency") <> '')
    );
ALTER TABLE "run_input_snapshots" ADD CONSTRAINT "run_input_snapshots_version_check" CHECK ("snapshot_version" > 0);
ALTER TABLE "run_input_snapshots" ADD CONSTRAINT "run_input_snapshots_nonempty_check" CHECK (
        btrim("silo_id") <> '' AND btrim("agent_service_id") <> '' AND btrim("agent_revision_id") <> '' AND
        btrim("effective_contract_digest") <> '' AND btrim("prompt_compiler_version") <> '' AND btrim("input_digest") <> '' AND
        "effective_contract_digest" ~ '^sha256:[0-9a-f]{64}$' AND "input_digest" ~ '^sha256:[0-9a-f]{64}$'
    );
ALTER TABLE "workload_assignments" ADD CONSTRAINT "workload_assignments_attempt_check" CHECK ("attempt" > 0);
ALTER TABLE "workload_assignments" ADD CONSTRAINT "workload_assignments_nonempty_check" CHECK (
        btrim("agent_service_id") <> '' AND btrim("agent_revision_id") <> '' AND btrim("silo_id") <> '' AND
        btrim("subject_id") <> '' AND "audience" = 'opencrane-agent-runtime' AND btrim("service_account_name") <> '' AND
        btrim("namespace") <> '' AND btrim("workload_uid") <> '' AND btrim("workload_profile") <> ''
    );
ALTER TABLE "workload_assignments" ADD CONSTRAINT "workload_assignments_expiry_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "workload_assignments" ADD CONSTRAINT "workload_assignments_state_check" CHECK (
        ("state" = 'pending_pod' AND "pod_uid" IS NULL AND "registered_at" IS NULL AND "revoked_at" IS NULL) OR
        ("state" = 'registered' AND "pod_uid" IS NOT NULL AND btrim("pod_uid") <> '' AND "registered_at" IS NOT NULL AND "revoked_at" IS NULL) OR
        ("state" = 'revoked' AND "revoked_at" IS NOT NULL)
    );
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_expiry_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_claim_digest_check" CHECK ("claim_digest" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_audience_check" CHECK ("audience" = 'opencrane-agent-runtime');
ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_consumption_check" CHECK (
        ("consumed_at" IS NULL AND "consumed_by_pod_uid" IS NULL AND "receipt_id" IS NULL) OR
        ("consumed_at" IS NOT NULL AND "consumed_by_pod_uid" IS NOT NULL AND btrim("consumed_by_pod_uid") <> '' AND "receipt_id" IS NOT NULL AND btrim("receipt_id") <> '')
    );
ALTER TABLE "run_proof_keys" ADD CONSTRAINT "run_proof_keys_nonempty_check" CHECK (btrim("workload_uid") <> '' AND btrim("pod_uid") <> '' AND "key_thumbprint" ~ '^[A-Za-z0-9_-]{43}$');
ALTER TABLE "run_proof_keys" ADD CONSTRAINT "run_proof_keys_expiry_check" CHECK ("expires_at" > "created_at");
ALTER TABLE "run_outbox_events" ADD CONSTRAINT "run_outbox_events_coordinate_check" CHECK ("attempt" > 0 AND "sequence" > 0);
ALTER TABLE "run_outbox_events" ADD CONSTRAINT "run_outbox_events_delivery_check" CHECK (
        "delivery_count" >= 0 AND NOT ("published_at" IS NOT NULL AND "failed_at" IS NOT NULL) AND
        (("claimed_at" IS NULL AND "delivery_count" = 0 AND "published_at" IS NULL AND "failed_at" IS NULL) OR
         ("claimed_at" IS NOT NULL AND "delivery_count" > 0)) AND
        ("published_at" IS NULL OR "published_at" >= "claimed_at") AND
        ("failed_at" IS NULL OR "failed_at" >= "claimed_at") AND
        (("failed_at" IS NULL AND "failure_code" IS NULL) OR
         ("failed_at" IS NOT NULL AND "failure_code" IS NOT NULL AND btrim("failure_code") <> ''))
    );
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_exact_check" CHECK (
        btrim("silo_id") <> '' AND btrim("subject_id") NOT IN ('', '*') AND
        btrim("organization_id") <> '' AND btrim("catalog_id") <> '' AND "catalog_revision" > 0 AND
        btrim("catalog_digest") <> '' AND "catalog_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("capability_id") <> '' AND
        btrim("resource_kind") NOT IN ('', '*') AND btrim("resource_id") NOT IN ('', '*') AND
        "priority" >= 0 AND btrim("created_by") <> ''
    );
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_scope_check" CHECK (
        ("scope_kind" = 'organization' AND "scope_resource_id" IS NULL) OR
        ("scope_kind" <> 'organization' AND "scope_resource_id" IS NOT NULL AND btrim("scope_resource_id") <> '')
    );
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_validity_check" CHECK ("expires_at" IS NULL OR "expires_at" > "valid_from");
ALTER TABLE "capability_catalog_revisions" ADD CONSTRAINT "capability_catalog_revisions_exact_check" CHECK (
        btrim("catalog_id") <> '' AND "revision" > 0 AND "digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("created_by") <> ''
    );
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_exact_check" CHECK (
        "attempt" > 0 AND btrim("agent_revision_id") <> '' AND btrim("agent_service_id") <> '' AND btrim("silo_id") <> '' AND
        "proof_key_thumbprint" ~ '^[A-Za-z0-9_-]{43}$' AND btrim("subject_id") <> '' AND
        btrim("workload_audience") <> '' AND btrim("service_account_name") <> '' AND btrim("namespace") <> '' AND
        btrim("workload_uid") <> '' AND btrim("pod_uid") <> '' AND
        btrim("catalog_id") <> '' AND "catalog_revision" > 0 AND "catalog_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        btrim("capability_id") <> '' AND btrim("resource_kind") NOT IN ('', '*') AND
        btrim("resource_id") NOT IN ('', '*') AND btrim("action") <> '' AND
        "arguments_digest" ~ '^sha256:[0-9a-f]{64}$' AND "action_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        btrim("approver_policy_revision") <> '' AND "effective_policy_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        "expires_at" > "created_at"
    );
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_check" CHECK (
        ("state" = 'pending' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "resume_token_hash" IS NULL) OR
        ("state" = 'approved' AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND btrim("decided_by") <> '' AND "resume_token_hash" IS NOT NULL AND btrim("resume_token_hash") <> '') OR
        ("state" = 'denied' AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND btrim("decided_by") <> '' AND "resume_token_hash" IS NULL) OR
        ("state" IN ('expired', 'cancelled') AND "decided_at" IS NOT NULL AND "resume_token_hash" IS NULL)
    );
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_exact_check" CHECK (
        btrim("silo_id") <> '' AND btrim("subject_id") <> '' AND btrim("audience") <> '' AND
        btrim("service_account_name") <> '' AND btrim("namespace") <> '' AND btrim("workload_uid") <> '' AND
        btrim("pod_uid") <> '' AND "attempt" > 0 AND btrim("agent_service_id") <> '' AND
        btrim("agent_revision_id") <> '' AND "proof_key_thumbprint" ~ '^[A-Za-z0-9_-]{43}$' AND
        btrim("catalog_id") <> '' AND "catalog_revision" > 0 AND "catalog_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("capability_id") <> '' AND
        "effective_policy_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("resource_kind") NOT IN ('', '*') AND
        btrim("resource_id") NOT IN ('', '*') AND btrim("action") <> '' AND "arguments_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        btrim("jti") <> '' AND "request_fingerprint" ~ '^sha256:[0-9a-f]{64}$'
    );
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_state_check" CHECK (
        ("state" = 'reserved' AND "completed_at" IS NULL AND "result" IS NULL AND "failure_code" IS NULL) OR
        ("state" = 'succeeded' AND "completed_at" IS NOT NULL AND "result" IS NOT NULL AND "failure_code" IS NULL) OR
        ("state" = 'failed' AND "completed_at" IS NOT NULL AND "result" IS NULL AND "failure_code" IS NOT NULL AND btrim("failure_code") <> '')
    );
ALTER TABLE "verified_fleet_membership_revisions" ADD CONSTRAINT "verified_fleet_membership_revisions_exact_check" CHECK (
        "revision" > 0 AND btrim("issuer_id") <> '' AND btrim("issuer_key_id") <> '' AND
        btrim("silo_id") <> '' AND "payload_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("signature") <> ''
    );
ALTER TABLE "verified_fleet_membership_revisions" ADD CONSTRAINT "verified_fleet_membership_revisions_time_check" CHECK (
        "issued_at" < "expires_at" AND "verified_at" >= "issued_at" AND "verified_at" < "expires_at"
    );
ALTER TABLE "verified_fleet_membership_assertions" ADD CONSTRAINT "verified_fleet_membership_assertions_exact_check" CHECK (
        btrim("assertion_id") <> '' AND btrim("silo_id") <> '' AND btrim("subject_id") <> '' AND
        btrim("organization_id") <> '' AND
        (("scope_kind" = 'organization' AND "scope_resource_id" IS NULL) OR
         ("scope_kind" <> 'organization' AND "scope_resource_id" IS NOT NULL AND btrim("scope_resource_id") <> ''))
    );
ALTER TABLE "highest_accepted_fleet_memberships" ADD CONSTRAINT "highest_accepted_fleet_memberships_revision_check" CHECK ("revision" > 0);
ALTER TABLE "audit_decisions" ADD CONSTRAINT "audit_decisions_exact_check" CHECK (
        "decision_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("silo_id") <> '' AND btrim("actor_id") <> '' AND
        btrim("resource_kind") NOT IN ('', '*') AND btrim("resource_id") NOT IN ('', '*') AND
        btrim("action") <> '' AND btrim("catalog_id") <> '' AND "catalog_revision" > 0 AND
        "catalog_digest" ~ '^sha256:[0-9a-f]{64}$' AND "arguments_digest" ~ '^sha256:[0-9a-f]{64}$' AND
        "policy_revision_hash" ~ '^sha256:[0-9a-f]{64}$' AND
        "effective_authorization_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("reason_code") <> ''
    );
ALTER TABLE "audit_decisions" ADD CONSTRAINT "audit_decisions_run_coordinate_check" CHECK (
        ("run_id" IS NULL AND "attempt" IS NULL) OR
        ("run_id" IS NOT NULL AND btrim("run_id") <> '' AND "attempt" IS NOT NULL AND "attempt" > 0)
    );
ALTER TABLE "audit_decisions" ADD CONSTRAINT "audit_decisions_workload_identity_check" CHECK (
        "actor_kind" <> 'workload' OR
        ("audience" IS NOT NULL AND btrim("audience") <> '' AND
         "namespace" IS NOT NULL AND btrim("namespace") <> '' AND
         "service_account_name" IS NOT NULL AND btrim("service_account_name") <> '' AND
         "workload_kind" IS NOT NULL AND "workload_uid" IS NOT NULL AND btrim("workload_uid") <> '' AND
         "pod_uid" IS NOT NULL AND btrim("pod_uid") <> '' AND
         "proof_key_thumbprint" IS NOT NULL AND "proof_key_thumbprint" ~ '^[A-Za-z0-9_-]{43}$')
    );
ALTER TABLE "audit_decisions" ADD CONSTRAINT "audit_decisions_membership_revision_check" CHECK ("membership_revision" IS NULL OR "membership_revision" > 0);
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_identity_check" CHECK (btrim("silo_id") <> '' AND btrim("agent_service_id") <> '');
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_check" CHECK (btrim("user_id") <> '');
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_source_check" CHECK ("source" IN ('user_input', 'model_output', 'tool_result', 'platform'));
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_blocks_check" CHECK (jsonb_typeof("blocks") = 'array');
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_provenance_check" CHECK (
        ("source" = 'user_input' AND "user_id" IS NOT NULL AND "run_id" IS NULL) OR
        ("source" <> 'user_input' AND "user_id" IS NULL)
    );
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_completion_check" CHECK (
        ("state" IN ('pending', 'streaming') AND "completed_at" IS NULL) OR
        ("state" IN ('completed', 'failed', 'cancelled') AND "completed_at" IS NOT NULL)
    );
ALTER TABLE "conversation_run_events" ADD CONSTRAINT "conversation_run_events_sequence_check" CHECK ("sequence" > 0);
ALTER TABLE "conversation_run_events" ADD CONSTRAINT "conversation_run_events_type_check" CHECK ("type" IN (
        'run.accepted', 'run.started', 'message.started', 'message.delta', 'message.completed',
        'tool.requested', 'tool.approval_required', 'tool.started', 'tool.progress', 'tool.completed',
        'context.compaction_started', 'context.compaction_completed', 'run.usage',
        'run.completed', 'run.failed', 'run.cancelled'
    ));
ALTER TABLE "conversation_run_events" ADD CONSTRAINT "conversation_run_events_payload_check" CHECK (jsonb_typeof("payload") = 'object');
ALTER TABLE "conversation_context_revisions" ADD CONSTRAINT "conversation_context_revisions_revision_check" CHECK ("revision" > 0);
ALTER TABLE "conversation_context_revisions" ADD CONSTRAINT "conversation_context_revisions_digest_check" CHECK ("digest" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "conversation_context_revisions" ADD CONSTRAINT "conversation_context_revisions_summary_check" CHECK (jsonb_typeof("summary") = 'object');
ALTER TABLE "persona_question_sets" ADD CONSTRAINT "persona_question_sets_valid_check" CHECK (
        btrim("question_set_id") <> '' AND "version" > 0 AND
        (("state" = 'draft' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL) OR
         ("state" = 'reviewed' AND "reviewed_by" IS NOT NULL AND btrim("reviewed_by") <> '' AND "reviewed_at" IS NOT NULL))
    );
ALTER TABLE "persona_questions" ADD CONSTRAINT "persona_questions_valid_check" CHECK (btrim("question_id") <> '' AND btrim("prompt") <> '' AND "ordinal" > 0);
ALTER TABLE "persona_soul_templates" ADD CONSTRAINT "persona_soul_templates_valid_check" CHECK (
        btrim("template_id") <> '' AND "version" > 0 AND "digest" ~ '^sha256:[0-9a-f]{64}$'
        AND btrim("content") <> '' AND jsonb_typeof("selection_rules") = 'array' AND btrim("reviewed_by") <> ''
    );
ALTER TABLE "persona_profiles" ADD CONSTRAINT "persona_profiles_identity_check" CHECK (btrim("silo_id") <> '' AND btrim("user_id") <> '');
ALTER TABLE "persona_interviews" ADD CONSTRAINT "persona_interviews_completion_check" CHECK (
        ("state" = 'in_progress' AND "completed_at" IS NULL) OR ("state" IN ('completed', 'retaken') AND "completed_at" IS NOT NULL)
    );
ALTER TABLE "persona_interview_answers" ADD CONSTRAINT "persona_interview_answers_value_check" CHECK (btrim("value") <> '');
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_valid_check" CHECK (
        "revision" > 0 AND "soul_template_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("selection_rule_id") <> ''
        AND cardinality("selection_answer_ids") > 0 AND btrim("compiled_instructions") <> ''
        AND btrim("authored_by") <> '' AND "durable_soul_mutation_policy" = 'forbidden'
    );
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_approval_check" CHECK (
        ("state" = 'draft' AND "approved_by" IS NULL AND "approved_at" IS NULL) OR
        ("state" = 'approved' AND "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
    );
ALTER TABLE "persona_revisions" ADD CONSTRAINT "persona_revisions_history_check" CHECK ("previous_revision_id" IS NULL OR "previous_revision_id" <> "id");
ALTER TABLE "persona_insights" ADD CONSTRAINT "persona_insights_statement_check" CHECK (btrim("statement") <> '');
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_identity_check" CHECK (btrim("silo_id") <> '' AND btrim("owner_principal_id") <> '');
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_retention_check" CHECK ("retention_policy" = 'until_authorized_deletion');
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_deletion_check" CHECK (("state" = 'deleted' AND "deleted_at" IS NOT NULL) OR ("state" <> 'deleted' AND "deleted_at" IS NULL));
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_content_check" CHECK (
        "revision" > 0 AND "content_address" ~ '^sha256:[0-9a-f]{64}$' AND "byte_length" >= 0
        AND btrim("media_type") <> '' AND strpos("media_type", '/') > 1 AND jsonb_typeof("provenance") = 'object' AND btrim("created_by") <> ''
    );
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_deletion_check" CHECK (
        ("state" = 'published' AND "deletion_requested_at" IS NULL AND "purged_at" IS NULL) OR
        ("state" = 'deletion_pending' AND "deletion_requested_at" IS NOT NULL AND "purged_at" IS NULL) OR
        ("state" = 'purged' AND "deletion_requested_at" IS NOT NULL AND "purged_at" IS NOT NULL)
    );
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_index_check" CHECK (
        ("index_state" = 'indexed' AND "cognee_external_id" IS NOT NULL) OR
        ("index_state" <> 'indexed')
    );
ALTER TABLE "artifact_revision_parents" ADD CONSTRAINT "artifact_revision_parents_no_self_check" CHECK ("child_revision_id" <> "parent_revision_id");
ALTER TABLE "artifact_outbox_events" ADD CONSTRAINT "artifact_outbox_events_valid_check" CHECK (btrim("idempotency_key") <> '' AND jsonb_typeof("payload") = 'object' AND "delivery_count" >= 0);
ALTER TABLE "skills" ADD CONSTRAINT "skills_identity_check" CHECK (btrim("silo_id") <> '' AND btrim("owner_principal_id") <> '' AND btrim("name") <> '');
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_content_check" CHECK (
        "revision" > 0 AND "artifact_content_address" ~ '^sha256:[0-9a-f]{64}$'
        AND jsonb_typeof("manifest") = 'object' AND jsonb_typeof("requirements") = 'object' AND btrim("authored_by") <> ''
    );
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_publication_check" CHECK (
        ("state" IN ('draft', 'review', 'rejected') AND "published_at" IS NULL AND "revoked_at" IS NULL) OR
        ("state" = 'published' AND "published_at" IS NOT NULL AND "revoked_at" IS NULL) OR
        ("state" = 'revoked' AND "published_at" IS NOT NULL AND "revoked_at" IS NOT NULL)
    );
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_review_check" CHECK (
        "state" NOT IN ('published', 'revoked') OR
        ("reviewed_by" IS NOT NULL AND btrim("reviewed_by") <> ''
         AND "test_report" @> '{"passed":true}'::jsonb AND "scan_result" @> '{"passed":true}'::jsonb
         AND "signature" IS NOT NULL AND btrim("signature") <> '' AND "signer_key_id" IS NOT NULL AND btrim("signer_key_id") <> '')
    );
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_identity_check" CHECK (btrim("silo_id") <> '' AND btrim("organization_id") <> '' AND btrim("cognee_dataset_id") <> '' AND btrim("created_by") <> '');
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_scope_check" CHECK (
        ("scope_kind" = 'organization' AND "scope_resource_id" IS NULL) OR
        ("scope_kind" <> 'organization' AND "scope_resource_id" IS NOT NULL AND btrim("scope_resource_id") <> '')
    );
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_retirement_check" CHECK (("state" = 'retired' AND "retired_at" IS NOT NULL) OR ("state" = 'active' AND "retired_at" IS NULL));
ALTER TABLE "memory_fact_catalog" ADD CONSTRAINT "memory_fact_catalog_valid_check" CHECK (
        btrim("cognee_external_id") <> '' AND "content_digest" ~ '^sha256:[0-9a-f]{64}$'
        AND btrim("sensitivity") <> '' AND jsonb_typeof("provenance") = 'object' AND btrim("recorded_by") <> ''
        AND ((CASE WHEN "source_artifact_revision_id" IS NOT NULL THEN 1 ELSE 0 END)
            + (CASE WHEN "source_message_id" IS NOT NULL THEN 1 ELSE 0 END)
            + (CASE WHEN "provenance" @> '{"user_statement":true}'::jsonb THEN 1 ELSE 0 END)) = 1
    );
ALTER TABLE "memory_fact_catalog" ADD CONSTRAINT "memory_fact_catalog_history_check" CHECK ("supersedes_fact_id" IS NULL OR "supersedes_fact_id" <> "id");
ALTER TABLE "memory_fact_catalog" ADD CONSTRAINT "memory_fact_catalog_forget_check" CHECK (
        ("state" = 'active' AND "corrected_at" IS NULL AND "forget_requested_at" IS NULL AND "forgotten_at" IS NULL) OR
        ("state" = 'corrected' AND "corrected_at" IS NOT NULL AND "forget_requested_at" IS NULL AND "forgotten_at" IS NULL) OR
        ("state" = 'forget_pending' AND "forget_requested_at" IS NOT NULL AND "forgotten_at" IS NULL) OR
        ("state" = 'forgotten' AND "forget_requested_at" IS NOT NULL AND "forgotten_at" IS NOT NULL)
    );
ALTER TABLE "memory_outbox_events" ADD CONSTRAINT "memory_outbox_events_valid_check" CHECK (btrim("idempotency_key") <> '' AND jsonb_typeof("payload") = 'object' AND "delivery_count" >= 0);
ALTER TABLE "artifact_upload_leases" ADD CONSTRAINT "artifact_upload_leases_identity_check" CHECK (btrim("silo_id") <> '' AND btrim("capability_jti") <> '' AND btrim("media_type") <> '' AND strpos("media_type", '/') > 1);
ALTER TABLE "artifact_upload_leases" ADD CONSTRAINT "artifact_upload_leases_expected_content_check" CHECK ("expected_content_address" IS NULL OR "expected_content_address" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "artifact_upload_leases" ADD CONSTRAINT "artifact_upload_leases_expected_length_check" CHECK ("expected_byte_length" IS NULL OR "expected_byte_length" >= 0);
ALTER TABLE "artifact_upload_leases" ADD CONSTRAINT "artifact_upload_leases_promotion_check" CHECK (
      ("state" = 'active' AND "promotion_receipt_digest" IS NULL AND "promoted_content_address" IS NULL AND "promoted_byte_length" IS NULL AND "promoted_at" IS NULL AND "finalized_at" IS NULL)
      OR ("state" = 'promoted' AND "promotion_receipt_digest" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_content_address" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_byte_length" >= 0 AND "promoted_at" IS NOT NULL AND "finalized_at" IS NULL)
      OR ("state" = 'finalized' AND "promotion_receipt_digest" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_content_address" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_byte_length" >= 0 AND "promoted_at" IS NOT NULL AND "finalized_at" IS NOT NULL)
      OR ("state" IN ('expired', 'cancelled') AND "finalized_at" IS NULL)
    );
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_identity_nonempty" CHECK (
    btrim("silo_id") <> '' AND btrim("obot_catalog_entry_id") <> '' AND btrim("display_name") <> ''
  );
ALTER TABLE "integration_custody_references" ADD CONSTRAINT "integration_custody_references_identity_nonempty" CHECK (
    btrim("integration_id") <> '' AND btrim("silo_id") <> '' AND btrim("obot_custody_reference") <> ''
  );
ALTER TABLE "integration_custody_references" ADD CONSTRAINT "integration_custody_references_revocation_evidence" CHECK (
    ("state" = 'revoked' AND "revoked_at" IS NOT NULL) OR ("state" <> 'revoked' AND "revoked_at" IS NULL)
  );
ALTER TABLE "agent_revision_integration_assignments" ADD CONSTRAINT "agent_revision_integration_assignments_allowed_tools_check" CHECK ("has_nonempty_distinct_tool_ids"("allowed_tools"));

-- Partial indexes
CREATE UNIQUE INDEX "memory_fact_catalog_single_successor_key" ON "memory_fact_catalog"("supersedes_fact_id") WHERE "supersedes_fact_id" IS NOT NULL;
CREATE UNIQUE INDEX "integration_custody_references_one_ready_per_integration"
  ON "integration_custody_references"("integration_id") WHERE "state" = 'ready' AND "revoked_at" IS NULL;

-- Triggers
CREATE TRIGGER "agent_revisions_immutable"
    BEFORE UPDATE ON "agent_revisions"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_immutability"();
CREATE TRIGGER "agent_revisions_no_delete"
    BEFORE DELETE ON "agent_revisions"
    FOR EACH ROW EXECUTE FUNCTION "reject_agent_revision_delete"();
CREATE TRIGGER "agent_services_closed_lifecycle"
    BEFORE INSERT OR UPDATE OR DELETE ON "agent_services"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_service_lifecycle"();
CREATE CONSTRAINT TRIGGER "agent_services_published_active_revision"
    AFTER INSERT OR UPDATE ON "agent_services"
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_service_published_active_revision"();
CREATE CONSTRAINT TRIGGER "active_agent_revisions_remain_published"
    AFTER UPDATE OF "state" ON "agent_revisions"
    DEFERRABLE INITIALLY IMMEDIATE
    FOR EACH ROW EXECUTE FUNCTION "protect_active_agent_revision_publication"();
CREATE TRIGGER "agent_revision_skill_assignments_immutable"
    BEFORE INSERT OR UPDATE OR DELETE ON "agent_revision_skill_assignments"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_assignment_immutability"();
CREATE TRIGGER "workload_assignments_current_attempt" BEFORE INSERT OR UPDATE OF "run_id", "attempt" ON "workload_assignments" FOR EACH ROW EXECUTE FUNCTION "enforce_current_workload_assignment_attempt"();
CREATE TRIGGER "run_outbox_events_accepted_attempt" BEFORE INSERT OR UPDATE OF "run_id", "attempt" ON "run_outbox_events" FOR EACH ROW EXECUTE FUNCTION "enforce_accepted_outbox_attempt"();
CREATE TRIGGER "run_input_snapshots_immutable" BEFORE UPDATE OR DELETE ON "run_input_snapshots" FOR EACH ROW EXECUTE FUNCTION "reject_run_input_snapshot_mutation"();
CREATE TRIGGER "agent_runs_initial_state"
    BEFORE INSERT ON "agent_runs"
    FOR EACH ROW EXECUTE FUNCTION "enforce_initial_agent_run_state"();
CREATE TRIGGER "agent_runs_current_authority"
    BEFORE INSERT OR UPDATE OF "attempt" ON "agent_runs"
    FOR EACH ROW EXECUTE FUNCTION "enforce_current_agent_run_authority"();
CREATE TRIGGER "agent_runs_authority_update" BEFORE UPDATE ON "agent_runs" FOR EACH ROW EXECUTE FUNCTION "enforce_agent_run_authority_update"();
CREATE TRIGGER "workload_bootstraps_single_use" BEFORE INSERT OR UPDATE OR DELETE ON "workload_bootstraps" FOR EACH ROW EXECUTE FUNCTION "enforce_workload_bootstrap_consumption"();
CREATE TRIGGER "run_proof_keys_consumed_bootstrap" BEFORE INSERT ON "run_proof_keys" FOR EACH ROW EXECUTE FUNCTION "enforce_run_proof_key_bootstrap"();
CREATE TRIGGER "workload_assignments_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "workload_assignments" FOR EACH ROW EXECUTE FUNCTION "enforce_workload_assignment_update"();
CREATE TRIGGER "run_proof_keys_immutable" BEFORE UPDATE OR DELETE ON "run_proof_keys" FOR EACH ROW EXECUTE FUNCTION "enforce_run_proof_key_update"();
CREATE TRIGGER "run_outbox_events_monotonic"
    BEFORE UPDATE OR DELETE ON "run_outbox_events"
    FOR EACH ROW EXECUTE FUNCTION "enforce_run_outbox_event_update"();
CREATE TRIGGER "capability_catalog_revisions_immutable" BEFORE UPDATE OR DELETE ON "capability_catalog_revisions" FOR EACH ROW EXECUTE FUNCTION "reject_capability_catalog_revision_mutation"();
CREATE TRIGGER "authorization_grants_immutable" BEFORE UPDATE OR DELETE ON "authorization_grants" FOR EACH ROW EXECUTE FUNCTION "enforce_authorization_grant_update"();
CREATE TRIGGER "approval_requests_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "approval_requests" FOR EACH ROW EXECUTE FUNCTION "enforce_approval_request_update"();
CREATE TRIGGER "action_execution_receipts_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "action_execution_receipts" FOR EACH ROW EXECUTE FUNCTION "enforce_action_execution_receipt_lifecycle"();
CREATE TRIGGER "verified_fleet_membership_revisions_immutable" BEFORE UPDATE OR DELETE ON "verified_fleet_membership_revisions" FOR EACH ROW EXECUTE FUNCTION "reject_verified_membership_revision_mutation"();
CREATE TRIGGER "verified_fleet_membership_assertions_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "verified_fleet_membership_assertions" FOR EACH ROW EXECUTE FUNCTION "reject_verified_membership_assertion_mutation"();
CREATE TRIGGER "highest_accepted_fleet_memberships_monotonic" BEFORE INSERT OR UPDATE OR DELETE ON "highest_accepted_fleet_memberships" FOR EACH ROW EXECUTE FUNCTION "enforce_highest_membership_revision"();
CREATE TRIGGER "audit_decisions_append_only" BEFORE UPDATE OR DELETE ON "audit_decisions" FOR EACH ROW EXECUTE FUNCTION "reject_audit_decision_mutation"();
CREATE TRIGGER "conversation_messages_closed_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "conversation_messages"
    FOR EACH ROW EXECUTE FUNCTION "enforce_conversation_message_lifecycle"();
CREATE TRIGGER "conversation_run_events_contiguous" BEFORE INSERT ON "conversation_run_events"
    FOR EACH ROW EXECUTE FUNCTION "enforce_conversation_run_event_append"();
CREATE TRIGGER "conversation_run_events_append_only" BEFORE UPDATE OR DELETE ON "conversation_run_events"
    FOR EACH ROW EXECUTE FUNCTION "reject_conversation_immutable_mutation"();
CREATE TRIGGER "conversation_context_revisions_append_only" BEFORE UPDATE OR DELETE ON "conversation_context_revisions"
    FOR EACH ROW EXECUTE FUNCTION "reject_conversation_immutable_mutation"();
CREATE TRIGGER "conversation_context_revisions_exact_provenance" BEFORE INSERT ON "conversation_context_revisions"
    FOR EACH ROW EXECUTE FUNCTION "enforce_conversation_context_provenance"();
CREATE CONSTRAINT TRIGGER "terminal_agent_runs_require_event" AFTER INSERT OR UPDATE OF "state" ON "agent_runs"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_terminal_agent_run_event"();
CREATE TRIGGER "persona_question_sets_closed_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "persona_question_sets"
    FOR EACH ROW EXECUTE FUNCTION "enforce_persona_question_set_lifecycle"();
CREATE TRIGGER "persona_questions_draft_only" BEFORE INSERT OR UPDATE OR DELETE ON "persona_questions"
    FOR EACH ROW EXECUTE FUNCTION "enforce_persona_question_mutation"();
CREATE TRIGGER "persona_interviews_closed_lifecycle" BEFORE UPDATE OR DELETE ON "persona_interviews" FOR EACH ROW EXECUTE FUNCTION "enforce_persona_interview_lifecycle"();
CREATE TRIGGER "persona_interview_answers_exact_question_set" BEFORE INSERT ON "persona_interview_answers" FOR EACH ROW EXECUTE FUNCTION "enforce_persona_answer_provenance"();
CREATE TRIGGER "persona_insights_exact_provenance" BEFORE INSERT ON "persona_insights" FOR EACH ROW EXECUTE FUNCTION "enforce_persona_insight_provenance"();
CREATE TRIGGER "persona_revisions_closed_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "persona_revisions" FOR EACH ROW EXECUTE FUNCTION "enforce_persona_revision_lifecycle"();
CREATE TRIGGER "persona_soul_templates_valid_rules" BEFORE INSERT ON "persona_soul_templates"
    FOR EACH ROW EXECUTE FUNCTION "enforce_persona_soul_template_rules"();
CREATE TRIGGER "persona_soul_templates_immutable" BEFORE UPDATE OR DELETE ON "persona_soul_templates" FOR EACH ROW EXECUTE FUNCTION "reject_persona_source_mutation"();
CREATE TRIGGER "persona_interview_answers_immutable" BEFORE UPDATE OR DELETE ON "persona_interview_answers" FOR EACH ROW EXECUTE FUNCTION "reject_persona_source_mutation"();
CREATE TRIGGER "persona_insights_immutable" BEFORE UPDATE OR DELETE ON "persona_insights" FOR EACH ROW EXECUTE FUNCTION "reject_persona_source_mutation"();
CREATE CONSTRAINT TRIGGER "personal_agent_revisions_require_approved_persona" AFTER INSERT OR UPDATE ON "agent_revisions"
    DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "enforce_personal_agent_persona"();
CREATE TRIGGER "persona_profiles_active_revision_approved" BEFORE INSERT OR UPDATE OF "active_revision_id" ON "persona_profiles"
    FOR EACH ROW EXECUTE FUNCTION "enforce_active_persona_revision"();
CREATE TRIGGER "artifact_revisions_silo_provenance" BEFORE INSERT OR UPDATE OF "artifact_id", "source_run_id", "source_message_id" ON "artifact_revisions"
    FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_revision_silo_provenance"();
CREATE TRIGGER "artifact_revisions_closed_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "artifact_revisions" FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_revision_lifecycle"();
CREATE TRIGGER "artifacts_closed_lifecycle" BEFORE UPDATE OR DELETE ON "artifacts" FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_lifecycle"();
CREATE CONSTRAINT TRIGGER "current_artifact_revisions_remain_published" AFTER UPDATE OF "state" ON "artifact_revisions" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "protect_current_artifact_revision"();
CREATE TRIGGER "artifact_revision_parents_immutable" BEFORE UPDATE OR DELETE ON "artifact_revision_parents" FOR EACH ROW EXECUTE FUNCTION "reject_artifact_parent_mutation"();
CREATE TRIGGER "artifact_revision_parents_same_silo" BEFORE INSERT ON "artifact_revision_parents"
    FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_parent_silo"();
CREATE TRIGGER "skill_revisions_closed_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "skill_revisions" FOR EACH ROW EXECUTE FUNCTION "enforce_skill_revision_lifecycle"();
CREATE TRIGGER "skills_closed_lifecycle" BEFORE UPDATE OR DELETE ON "skills" FOR EACH ROW EXECUTE FUNCTION "enforce_skill_lifecycle"();
CREATE TRIGGER "skills_current_revision_published" BEFORE INSERT OR UPDATE ON "skills" FOR EACH ROW EXECUTE FUNCTION "enforce_current_skill_revision"();
CREATE CONSTRAINT TRIGGER "assigned_skill_revisions_remain_published" AFTER UPDATE OF "state" ON "skill_revisions" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "protect_assigned_skill_revision"();
CREATE CONSTRAINT TRIGGER "skill_artifact_revisions_remain_published" AFTER UPDATE OF "state" ON "artifact_revisions"
    DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION "protect_skill_artifact_revision"();
CREATE TRIGGER "agent_revision_skill_assignments_same_silo" BEFORE INSERT OR UPDATE ON "agent_revision_skill_assignments"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_skill_assignment_silo"();
CREATE TRIGGER "memory_datasets_closed_lifecycle" BEFORE UPDATE OR DELETE ON "memory_datasets" FOR EACH ROW EXECUTE FUNCTION "enforce_memory_dataset_lifecycle"();
CREATE TRIGGER "memory_fact_catalog_closed_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "memory_fact_catalog" FOR EACH ROW EXECUTE FUNCTION "enforce_memory_fact_lifecycle"();
CREATE CONSTRAINT TRIGGER "corrected_memory_facts_require_successor" AFTER INSERT OR UPDATE OF "state" ON "memory_fact_catalog"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_corrected_memory_successor"();
CREATE TRIGGER "artifact_upload_leases_silo_and_lifecycle" BEFORE INSERT OR UPDATE ON "artifact_upload_leases" FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_upload_lease_silo_and_lifecycle"();
CREATE TRIGGER "integrations_closed_lifecycle"
  BEFORE INSERT OR UPDATE OR DELETE ON "integrations"
  FOR EACH ROW EXECUTE FUNCTION "enforce_integration_lifecycle"();
CREATE TRIGGER "integration_custody_references_closed_lifecycle"
  BEFORE INSERT OR UPDATE OR DELETE ON "integration_custody_references"
  FOR EACH ROW EXECUTE FUNCTION "enforce_integration_custody_lifecycle"();
CREATE TRIGGER "agent_revision_integration_assignments_authority"
  BEFORE INSERT OR UPDATE ON "agent_revision_integration_assignments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_integration_assignment_authority"();
CREATE TRIGGER "agent_revision_integration_assignments_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "agent_revision_integration_assignments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_assignment_immutability"();

-- Run-input snapshot guards
CREATE FUNCTION enforce_agent_run_input_snapshot_completeness()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "run_input_snapshots" snapshot
        WHERE snapshot."run_id" = NEW."id"
          AND snapshot."input_digest" = NEW."input_snapshot_digest"
          AND snapshot."thread_id" IS NOT DISTINCT FROM NEW."thread_id"
          AND snapshot."silo_id" = NEW."silo_id"
          AND snapshot."agent_service_id" = NEW."agent_service_id"
          AND snapshot."agent_revision_id" = NEW."agent_revision_id"
          AND snapshot."effective_contract_digest" = NEW."effective_contract_digest"
    ) THEN
        RAISE EXCEPTION 'AgentRun requires its exact immutable RunInputSnapshot' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER agent_runs_input_snapshot_complete
AFTER INSERT OR UPDATE OF "input_snapshot_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest"
ON "agent_runs" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION enforce_agent_run_input_snapshot_completeness();

CREATE FUNCTION enforce_run_input_snapshot_run_binding()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "agent_runs" run
        WHERE run."id" = NEW."run_id"
          AND run."input_snapshot_digest" = NEW."input_digest"
          AND run."thread_id" IS NOT DISTINCT FROM NEW."thread_id"
          AND run."silo_id" = NEW."silo_id"
          AND run."agent_service_id" = NEW."agent_service_id"
          AND run."agent_revision_id" = NEW."agent_revision_id"
          AND run."effective_contract_digest" = NEW."effective_contract_digest"
    ) THEN
        RAISE EXCEPTION 'RunInputSnapshot must bind the exact AgentRun thread and authority' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER run_input_snapshots_run_binding
AFTER INSERT OR UPDATE OF "run_id", "input_digest", "thread_id", "silo_id", "agent_service_id", "agent_revision_id", "effective_contract_digest"
ON "run_input_snapshots" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION enforce_run_input_snapshot_run_binding();
