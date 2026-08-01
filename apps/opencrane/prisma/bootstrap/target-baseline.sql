-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentServiceKind" AS ENUM ('personal', 'managed');

-- CreateEnum
CREATE TYPE "AgentServiceState" AS ENUM ('draft', 'active', 'paused', 'retired');

-- CreateEnum
CREATE TYPE "AgentRevisionState" AS ENUM ('draft', 'published', 'rejected', 'retired');

-- CreateEnum
CREATE TYPE "AgentScheduleOverlapPolicy" AS ENUM ('skip', 'allow');

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
CREATE TYPE "ArtifactPreprocessJobState" AS ENUM ('pending', 'claimed', 'completed', 'retryable_failed', 'terminal_failed');

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
CREATE TYPE "ChannelInvocationAction" AS ENUM ('command.forward', 'events.read');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'member');

-- CreateEnum
CREATE TYPE "OrgMemberStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "ConversationThreadState" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ConversationMessageRole" AS ENUM ('user', 'assistant', 'tool', 'system');

-- CreateEnum
CREATE TYPE "ConversationMessageState" AS ENUM ('pending', 'streaming', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "GrantScope" AS ENUM ('org', 'department', 'team', 'project', 'personal');

-- CreateEnum
CREATE TYPE "GrantSubjectType" AS ENUM ('group', 'user');

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
CREATE TYPE "PersonalConfigurationChangeState" AS ENUM ('proposed', 'accepted', 'applied', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "PersonaInterviewCategory" AS ENUM ('relationship_role', 'tone_language', 'answer_structure', 'challenge_support', 'initiative', 'approval_risk', 'working_habits', 'memory_boundaries');

-- CreateEnum
CREATE TYPE "PersonaQuestionSetState" AS ENUM ('draft', 'reviewed');

-- CreateEnum
CREATE TYPE "PersonaInterviewState" AS ENUM ('in_progress', 'completed');

-- CreateEnum
CREATE TYPE "PersonaRevisionState" AS ENUM ('draft', 'approved');

-- CreateEnum
CREATE TYPE "ModelRoutingScope" AS ENUM ('global', 'clusterTenant');

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
CREATE TYPE "ChildRunCompletionDeliveryOutcome" AS ENUM ('delivered', 'no_parent_stream', 'parent_stream_terminal');

-- CreateEnum
CREATE TYPE "RuntimeCommandKind" AS ENUM ('start_attempt', 'resume_attempt', 'cancel_attempt');

-- CreateEnum
CREATE TYPE "RuntimeSteeringDisposition" AS ENUM ('absorbed', 'deferred');

-- CreateEnum
CREATE TYPE "RuntimeSteeringRequestState" AS ENUM ('pending', 'consumed');

-- CreateEnum
CREATE TYPE "SkillState" AS ENUM ('active', 'retired');

-- CreateEnum
CREATE TYPE "SkillRevisionState" AS ENUM ('draft', 'review', 'published', 'rejected', 'revoked');

-- CreateEnum
CREATE TYPE "SkillTrustClass" AS ENUM ('reviewed_instructions', 'sandboxed_python');

-- CreateEnum
CREATE TYPE "SkillWorkloadKind" AS ENUM ('authoring', 'tool_runner');

-- CreateEnum
CREATE TYPE "SkillWorkloadState" AS ENUM ('pending', 'assigned', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "agent_services" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "kind" "AgentServiceKind" NOT NULL,
    "name" TEXT NOT NULL,
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
    "parent_revision_id" TEXT,
    "source_revision_id" TEXT,
    "change_message" TEXT NOT NULL DEFAULT '',
    "state" "AgentRevisionState" NOT NULL DEFAULT 'draft',
    "digest" TEXT NOT NULL,
    "prompt_policy_version" TEXT NOT NULL,
    "persona_revision_id" TEXT,
    "model_definition_id" TEXT NOT NULL,
    "budget" JSONB NOT NULL,
    "authored_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "agent_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_revision_scope_attachments" (
    "agent_revision_id" TEXT NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "subject_type" "GrantSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,

    CONSTRAINT "agent_revision_scope_attachments_pkey" PRIMARY KEY ("agent_revision_id","scope","subject_type","subject_id")
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
CREATE TABLE "agent_service_schedules" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "overlap_policy" "AgentScheduleOverlapPolicy" NOT NULL DEFAULT 'skip',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "catchup_window_seconds" INTEGER NOT NULL DEFAULT 3600,
    "last_scheduled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_service_schedules_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "artifact_preprocess_jobs" (
    "id" TEXT NOT NULL,
    "source_revision_id" TEXT NOT NULL,
    "pipeline_version" TEXT NOT NULL,
    "state" "ArtifactPreprocessJobState" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "claim_fence" TEXT,
    "claim_expires_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "derived_artifact_id" TEXT,
    "derived_revision_id" TEXT,
    "output_lease_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_preprocess_jobs_pkey" PRIMARY KEY ("id")
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
    "require_approval" BOOLEAN NOT NULL DEFAULT false,
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
    "catalog_id" TEXT,
    "catalog_revision" INTEGER,
    "catalog_digest" TEXT,
    "capability_id" TEXT,
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
    "tool_invocation_row_id" TEXT,
    "deferred_tool_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_invocations" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "tool_revision_id" TEXT NOT NULL,
    "tool_invocation_id" TEXT NOT NULL,
    "arguments_digest" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "approval_required" BOOLEAN NOT NULL DEFAULT false,
    "state" "ActionExecutionState" NOT NULL DEFAULT 'reserved',
    "result" JSONB,
    "failure_code" TEXT,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
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
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "personal_configuration_changes" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "persona_profile_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "source_thread_id" TEXT NOT NULL,
    "source_run_id" TEXT NOT NULL,
    "source_message_id" TEXT,
    "requested_patch" JSONB NOT NULL,
    "requested_patch_digest" TEXT NOT NULL,
    "expected_persona_revision_id" TEXT,
    "expected_agent_revision_id" TEXT,
    "applied_persona_revision_id" TEXT,
    "applied_agent_revision_id" TEXT,
    "state" "PersonalConfigurationChangeState" NOT NULL DEFAULT 'proposed',
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "rejection_reason" TEXT,

    CONSTRAINT "personal_configuration_changes_pkey" PRIMARY KEY ("id")
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
    "refresh_configuration_change_id" TEXT,
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
CREATE TABLE "child_run_completion_deliveries" (
    "child_run_id" TEXT NOT NULL,
    "parent_run_id" TEXT NOT NULL,
    "parent_event_sequence" INTEGER,
    "outcome" "ChildRunCompletionDeliveryOutcome" NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_run_completion_deliveries_pkey" PRIMARY KEY ("child_run_id")
);

-- CreateTable
CREATE TABLE "child_run_reservations" (
    "child_run_id" TEXT NOT NULL,
    "parent_run_id" TEXT NOT NULL,
    "root_run_id" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "max_tokens" INTEGER NOT NULL,
    "max_cost_usd_micros" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "child_run_reservations_pkey" PRIMARY KEY ("child_run_id")
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
    "integration_assignments" JSONB NOT NULL,
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
    "input_generation" INTEGER NOT NULL DEFAULT 0,
    "runtime_instance_id" TEXT,
    "next_command_sequence" INTEGER NOT NULL DEFAULT 1,
    "accepted_candidate_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_command_streams_pkey" PRIMARY KEY ("run_id","attempt")
);

-- CreateTable
CREATE TABLE "runtime_external_action_retries" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "retry_deadline_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_external_action_retries_pkey" PRIMARY KEY ("run_id","attempt","candidate_id")
);

-- CreateTable
CREATE TABLE "runtime_steering_boundaries" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "boundary_id" TEXT NOT NULL,
    "from_input_generation" INTEGER NOT NULL,
    "to_input_generation" INTEGER NOT NULL,
    "disposition" "RuntimeSteeringDisposition" NOT NULL,
    "steering_digest" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acked_at" TIMESTAMP(3),

    CONSTRAINT "runtime_steering_boundaries_pkey" PRIMARY KEY ("run_id","attempt","boundary_id")
);

-- CreateTable
CREATE TABLE "runtime_steering_requests" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "silo_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "state" "RuntimeSteeringRequestState" NOT NULL DEFAULT 'pending',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "runtime_steering_requests_pkey" PRIMARY KEY ("id")
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
    "payload" JSONB,
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
CREATE TABLE "skill_workloads" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "kind" "SkillWorkloadKind" NOT NULL,
    "state" "SkillWorkloadState" NOT NULL DEFAULT 'pending',
    "skill_revision_id" TEXT NOT NULL,
    "tool_invocation_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "delivery_count" INTEGER NOT NULL DEFAULT 0,
    "workload_uid" TEXT,
    "worker_pod_uid" TEXT,
    "release_claimed_at" TIMESTAMP(3),
    "release_delivery_count" INTEGER NOT NULL DEFAULT 0,
    "release_expires_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "skill_workloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_workload_bootstraps" (
    "id" TEXT NOT NULL,
    "skill_workload_id" TEXT NOT NULL,
    "reference_hash" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "service_account_name" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "workload_uid" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_by_pod_uid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_workload_bootstraps_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE INDEX "agent_services_silo_id_kind_state_idx" ON "agent_services"("silo_id", "kind", "state");

-- CreateIndex
CREATE UNIQUE INDEX "agent_services_id_active_revision_id_key" ON "agent_services"("id", "active_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_services_id_silo_id_key" ON "agent_services"("id", "silo_id");

-- CreateIndex
CREATE INDEX "agent_revisions_digest_idx" ON "agent_revisions"("digest");

-- CreateIndex
CREATE INDEX "agent_revisions_parent_revision_id_idx" ON "agent_revisions"("parent_revision_id");

-- CreateIndex
CREATE INDEX "agent_revisions_source_revision_id_idx" ON "agent_revisions"("source_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revisions_agent_service_id_revision_key" ON "agent_revisions"("agent_service_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revisions_agent_service_id_id_key" ON "agent_revisions"("agent_service_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revisions_agent_service_id_digest_key" ON "agent_revisions"("agent_service_id", "digest");

-- CreateIndex
CREATE INDEX "agent_revision_scope_attachments_scope_subject_type_subject_idx" ON "agent_revision_scope_attachments"("scope", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_revision_skill_assignments_agent_revision_id_skill_re_key" ON "agent_revision_skill_assignments"("agent_revision_id", "skill_revision_id");

-- CreateIndex
CREATE INDEX "agent_revision_integration_assignments_integration_id_silo__idx" ON "agent_revision_integration_assignments"("integration_id", "silo_id");

-- CreateIndex
CREATE INDEX "agent_service_schedules_silo_id_agent_service_id_idx" ON "agent_service_schedules"("silo_id", "agent_service_id");

-- CreateIndex
CREATE INDEX "agent_service_schedules_enabled_idx" ON "agent_service_schedules"("enabled");

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
CREATE UNIQUE INDEX "artifact_preprocess_jobs_output_lease_id_key" ON "artifact_preprocess_jobs"("output_lease_id");

-- CreateIndex
CREATE INDEX "artifact_preprocess_jobs_state_next_attempt_at_claim_expire_idx" ON "artifact_preprocess_jobs"("state", "next_attempt_at", "claim_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_source_revision_id_pipeline_versio_key" ON "artifact_preprocess_jobs"("source_revision_id", "pipeline_version");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_derived_artifact_id_key" ON "artifact_preprocess_jobs"("derived_artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_derived_revision_id_key" ON "artifact_preprocess_jobs"("derived_revision_id");

-- CreateIndex
CREATE INDEX "artifact_revision_parents_parent_revision_id_idx" ON "artifact_revision_parents"("parent_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_outbox_events_idempotency_key_key" ON "artifact_outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "artifact_outbox_events_published_at_available_at_idx" ON "artifact_outbox_events"("published_at", "available_at");

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
CREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"("silo_id", "subject_id", "scope_kind", "organization_id", "scope_resource_id", "catalog_id", "catalog_revision", "capability_id", "resource_kind", "resource_id", "effect", "priority");

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
CREATE UNIQUE INDEX "tool_invocations_request_fingerprint_key" ON "tool_invocations"("request_fingerprint");

-- CreateIndex
CREATE INDEX "tool_invocations_run_id_attempt_state_idx" ON "tool_invocations"("run_id", "attempt", "state");

-- CreateIndex
CREATE UNIQUE INDEX "tool_invocations_run_id_attempt_tool_invocation_id_key" ON "tool_invocations"("run_id", "attempt", "tool_invocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_execution_receipts_jti_key" ON "action_execution_receipts"("jti");

-- CreateIndex
CREATE UNIQUE INDEX "action_execution_receipts_request_fingerprint_key" ON "action_execution_receipts"("request_fingerprint");

-- CreateIndex
CREATE INDEX "action_execution_receipts_run_id_attempt_state_idx" ON "action_execution_receipts"("run_id", "attempt", "state");

-- CreateIndex
CREATE INDEX "action_execution_receipts_replay_mode_state_idx" ON "action_execution_receipts"("replay_mode", "state");

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
CREATE UNIQUE INDEX "model_routing_defaults_scope_cluster_tenant_key" ON "model_routing_defaults"("scope", "cluster_tenant");

-- CreateIndex
CREATE INDEX "personal_configuration_changes_silo_id_user_id_proposed_at_idx" ON "personal_configuration_changes"("silo_id", "user_id", "proposed_at");

-- CreateIndex
CREATE INDEX "personal_configuration_changes_source_run_id_idx" ON "personal_configuration_changes"("source_run_id");

-- CreateIndex
CREATE INDEX "personal_configuration_changes_persona_profile_id_state_pro_idx" ON "personal_configuration_changes"("persona_profile_id", "state", "proposed_at");

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
CREATE UNIQUE INDEX "persona_interviews_refresh_configuration_change_id_key" ON "persona_interviews"("refresh_configuration_change_id");

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
CREATE INDEX "child_run_completion_deliveries_parent_run_id_idx" ON "child_run_completion_deliveries"("parent_run_id");

-- CreateIndex
CREATE INDEX "child_run_reservations_parent_run_id_idx" ON "child_run_reservations"("parent_run_id");

-- CreateIndex
CREATE INDEX "child_run_reservations_root_run_id_idx" ON "child_run_reservations"("root_run_id");

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
CREATE INDEX "runtime_external_action_retries_run_id_attempt_retry_deadli_idx" ON "runtime_external_action_retries"("run_id", "attempt", "retry_deadline_at");

-- CreateIndex
CREATE INDEX "runtime_steering_boundaries_run_id_attempt_idx" ON "runtime_steering_boundaries"("run_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_steering_boundaries_run_id_attempt_to_input_generat_key" ON "runtime_steering_boundaries"("run_id", "attempt", "to_input_generation");

-- CreateIndex
CREATE INDEX "runtime_steering_requests_run_id_attempt_state_submitted_at_idx" ON "runtime_steering_requests"("run_id", "attempt", "state", "submitted_at");

-- CreateIndex
CREATE INDEX "runtime_steering_requests_silo_id_subject_id_submitted_at_idx" ON "runtime_steering_requests"("silo_id", "subject_id", "submitted_at");

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
CREATE UNIQUE INDEX "skill_workloads_tool_invocation_id_key" ON "skill_workloads"("tool_invocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_workloads_workload_uid_key" ON "skill_workloads"("workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "skill_workloads_worker_pod_uid_key" ON "skill_workloads"("worker_pod_uid");

-- CreateIndex
CREATE INDEX "skill_workloads_silo_id_state_created_at_idx" ON "skill_workloads"("silo_id", "state", "created_at");

-- CreateIndex
CREATE INDEX "skill_workloads_state_release_claimed_at_idx" ON "skill_workloads"("state", "release_claimed_at");

-- CreateIndex
CREATE UNIQUE INDEX "skill_workload_bootstraps_skill_workload_id_key" ON "skill_workload_bootstraps"("skill_workload_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_workload_bootstraps_reference_hash_key" ON "skill_workload_bootstraps"("reference_hash");

-- CreateIndex
CREATE INDEX "skill_workload_bootstraps_expires_at_idx" ON "skill_workload_bootstraps"("expires_at");

-- CreateIndex
CREATE INDEX "token_usage_snapshots_sampled_at_idx" ON "token_usage_snapshots"("sampled_at");

-- CreateIndex
CREATE UNIQUE INDEX "token_usage_snapshots_user_id_currency_key" ON "token_usage_snapshots"("user_id", "currency");

-- AddForeignKey
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_id_active_revision_id_fkey" FOREIGN KEY ("id", "active_revision_id") REFERENCES "agent_revisions"("agent_service_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_agent_service_id_fkey" FOREIGN KEY ("agent_service_id") REFERENCES "agent_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_model_definition_id_fkey" FOREIGN KEY ("model_definition_id") REFERENCES "model_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_parent_revision_id_fkey" FOREIGN KEY ("parent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_scope_attachments" ADD CONSTRAINT "agent_revision_scope_attachments_agent_revision_id_fkey" FOREIGN KEY ("agent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_skill_assignments" ADD CONSTRAINT "agent_revision_skill_assignments_agent_revision_id_fkey" FOREIGN KEY ("agent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_integration_assignments" ADD CONSTRAINT "agent_revision_integration_assignments_agent_revision_id_fkey" FOREIGN KEY ("agent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_integration_assignments" ADD CONSTRAINT "agent_revision_integration_assignments_integration_id_silo_fkey" FOREIGN KEY ("integration_id", "silo_id") REFERENCES "integrations"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_integration_assignments" ADD CONSTRAINT "agent_revision_integration_assignments_custody_reference_i_fkey" FOREIGN KEY ("custody_reference_id", "integration_id", "silo_id") REFERENCES "integration_custody_references"("id", "integration_id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_service_schedules" ADD CONSTRAINT "agent_service_schedules_agent_service_id_silo_id_fkey" FOREIGN KEY ("agent_service_id", "silo_id") REFERENCES "agent_services"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_id_current_revision_id_fkey" FOREIGN KEY ("id", "current_revision_id") REFERENCES "artifact_revisions"("artifact_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_upload_leases" ADD CONSTRAINT "artifact_upload_leases_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_revisions" ADD CONSTRAINT "artifact_revisions_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_preprocess_jobs" ADD CONSTRAINT "artifact_preprocess_jobs_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "artifact_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_preprocess_jobs" ADD CONSTRAINT "artifact_preprocess_jobs_derived_artifact_id_fkey" FOREIGN KEY ("derived_artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_preprocess_jobs" ADD CONSTRAINT "artifact_preprocess_jobs_derived_revision_id_fkey" FOREIGN KEY ("derived_revision_id") REFERENCES "artifact_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_preprocess_jobs" ADD CONSTRAINT "artifact_preprocess_jobs_output_lease_id_fkey" FOREIGN KEY ("output_lease_id") REFERENCES "artifact_upload_leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_revision_parents" ADD CONSTRAINT "artifact_revision_parents_child_revision_id_fkey" FOREIGN KEY ("child_revision_id") REFERENCES "artifact_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_revision_parents" ADD CONSTRAINT "artifact_revision_parents_parent_revision_id_fkey" FOREIGN KEY ("parent_revision_id") REFERENCES "artifact_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_outbox_events" ADD CONSTRAINT "artifact_outbox_events_artifact_id_revision_id_fkey" FOREIGN KEY ("artifact_id", "revision_id") REFERENCES "artifact_revisions"("artifact_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_catalog_id_catalog_revision_catalog_d_fkey" FOREIGN KEY ("catalog_id", "catalog_revision", "catalog_digest") REFERENCES "capability_catalog_revisions"("catalog_id", "revision", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_agent_service_id_agent_revision_i_fkey" FOREIGN KEY ("run_id", "agent_service_id", "agent_revision_id") REFERENCES "agent_runs"("id", "agent_service_id", "agent_revision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tool_invocation_row_id_fkey" FOREIGN KEY ("tool_invocation_row_id") REFERENCES "tool_invocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_proof_key_id_run_id_attempt_workload_kin_fkey" FOREIGN KEY ("proof_key_id", "run_id", "attempt", "workload_kind", "workload_uid", "proof_key_thumbprint", "pod_uid") REFERENCES "run_proof_keys"("id", "run_id", "attempt", "workload_kind", "workload_uid", "key_thumbprint", "pod_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_attempt_agent_service_id_agent_re_fkey" FOREIGN KEY ("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "workload_audience", "service_account_name", "namespace", "workload_kind", "workload_uid") REFERENCES "workload_assignments"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "audience", "service_account_name", "namespace", "workload_kind", "workload_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_catalog_id_catalog_revision_catalog_dige_fkey" FOREIGN KEY ("catalog_id", "catalog_revision", "catalog_digest") REFERENCES "capability_catalog_revisions"("catalog_id", "revision", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_agent_service_id_agent_revision_id_fkey" FOREIGN KEY ("run_id", "agent_service_id", "agent_revision_id") REFERENCES "agent_runs"("id", "agent_service_id", "agent_revision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_run_id_agent_service_id_agent_re_fkey" FOREIGN KEY ("run_id", "agent_service_id", "agent_revision_id") REFERENCES "agent_runs"("id", "agent_service_id", "agent_revision_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_proof_key_id_run_id_attempt_work_fkey" FOREIGN KEY ("proof_key_id", "run_id", "attempt", "workload_kind", "workload_uid", "proof_key_thumbprint", "pod_uid") REFERENCES "run_proof_keys"("id", "run_id", "attempt", "workload_kind", "workload_uid", "key_thumbprint", "pod_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_catalog_id_catalog_revision_cata_fkey" FOREIGN KEY ("catalog_id", "catalog_revision", "catalog_digest") REFERENCES "capability_catalog_revisions"("catalog_id", "revision", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_execution_receipts" ADD CONSTRAINT "action_execution_receipts_run_id_attempt_agent_service_id__fkey" FOREIGN KEY ("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "service_account_name", "namespace", "workload_kind", "workload_uid") REFERENCES "workload_assignments"("run_id", "attempt", "agent_service_id", "agent_revision_id", "silo_id", "subject_id", "service_account_name", "namespace", "workload_kind", "workload_uid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_route_id_silo_id_agent_service_fkey" FOREIGN KEY ("route_id", "silo_id", "agent_service_id", "action") REFERENCES "channel_runtime_routes"("id", "silo_id", "agent_service_id", "action") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_id_context_revision_id_fkey" FOREIGN KEY ("id", "context_revision_id") REFERENCES "conversation_context_revisions"("thread_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_context_revisions" ADD CONSTRAINT "conversation_context_revisions_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "conversation_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "persona_interviews" ADD CONSTRAINT "persona_interviews_refresh_configuration_change_id_fkey" FOREIGN KEY ("refresh_configuration_change_id") REFERENCES "personal_configuration_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "third_party_source_items" ADD CONSTRAINT "third_party_source_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "third_party_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_service_id_agent_revision_id_fkey" FOREIGN KEY ("agent_service_id", "agent_revision_id") REFERENCES "agent_revisions"("agent_service_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_service_id_silo_id_fkey" FOREIGN KEY ("agent_service_id", "silo_id") REFERENCES "agent_services"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_run_completion_deliveries" ADD CONSTRAINT "child_run_completion_deliveries_child_run_id_fkey" FOREIGN KEY ("child_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_run_completion_deliveries" ADD CONSTRAINT "child_run_completion_deliveries_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_run_reservations" ADD CONSTRAINT "child_run_reservations_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child_run_reservations" ADD CONSTRAINT "child_run_reservations_child_run_id_fkey" FOREIGN KEY ("child_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "runtime_external_action_retries" ADD CONSTRAINT "runtime_external_action_retries_run_id_attempt_fkey" FOREIGN KEY ("run_id", "attempt") REFERENCES "runtime_command_streams"("run_id", "attempt") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_steering_requests" ADD CONSTRAINT "runtime_steering_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_dispatched_commands" ADD CONSTRAINT "runtime_dispatched_commands_run_id_attempt_fkey" FOREIGN KEY ("run_id", "attempt") REFERENCES "runtime_command_streams"("run_id", "attempt") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_id_current_revision_id_fkey" FOREIGN KEY ("id", "current_revision_id") REFERENCES "skill_revisions"("skill_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_revisions" ADD CONSTRAINT "skill_revisions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_workloads" ADD CONSTRAINT "skill_workloads_skill_revision_id_fkey" FOREIGN KEY ("skill_revision_id") REFERENCES "skill_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_workloads" ADD CONSTRAINT "skill_workloads_tool_invocation_id_fkey" FOREIGN KEY ("tool_invocation_id") REFERENCES "tool_invocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_workload_bootstraps" ADD CONSTRAINT "skill_workload_bootstraps_skill_workload_id_fkey" FOREIGN KEY ("skill_workload_id") REFERENCES "skill_workloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

