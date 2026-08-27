-- OpenCrane 0.9.3 to 0.10.0 workflow and OCI cutover.
-- This forward-only migration keeps released history unchanged and uses Prisma Migrate as the sole ledger.
BEGIN;

DROP VIEW IF EXISTS "artifact_preprocess_claim_candidates";
DROP TRIGGER IF EXISTS "integrations_closed_lifecycle" ON "integrations";
DROP TRIGGER IF EXISTS "integration_custody_references_closed_lifecycle" ON "integration_custody_references";
DROP TRIGGER IF EXISTS "agent_revision_integration_assignments_authority" ON "agent_revision_integration_assignments";
DROP TRIGGER IF EXISTS "agent_revision_integration_assignments_immutable" ON "agent_revision_integration_assignments";
ALTER TABLE "user_onboarding_bootstrap_conversations" DROP CONSTRAINT IF EXISTS "user_onboarding_bootstrap_conversations_content_revision_fkey";
ALTER TABLE "user_onboarding_bootstrap_conversations" DROP CONSTRAINT IF EXISTS "user_onboarding_bootstrap_conversations_persona_revision_id_fkey";
ALTER TABLE "user_onboardings" DROP CONSTRAINT IF EXISTS "user_onboardings_bootstrap_content_revision_fkey";
ALTER TABLE "mcp_servers" DROP CONSTRAINT IF EXISTS "mcp_servers_era_probe_evidence_check";
ALTER TABLE "channel_invocation_contexts" DROP CONSTRAINT IF EXISTS "channel_invocation_contexts_route_id_receiver_id_silo_id_agent_service_fkey";
ALTER TABLE "conversation_asset_output_tickets" DROP CONSTRAINT IF EXISTS "conversation_asset_output_tickets_conversation_id_run_id_run_event_sequence_fkey";
ALTER TABLE "conversation_assets" DROP CONSTRAINT IF EXISTS "conversation_assets_conversation_id_run_id_run_event_sequence_fkey";
ALTER TABLE "run_input_snapshots" DROP CONSTRAINT IF EXISTS "run_input_snapshots_run_input_check";
ALTER TABLE "artifact_preprocess_jobs" DROP CONSTRAINT IF EXISTS "artifact_preprocess_jobs_identity_check";
DROP INDEX IF EXISTS "artifact_preprocess_jobs_state_next_attempt_at_claim_expires_at_idx";
DROP INDEX IF EXISTS "artifact_preprocess_jobs_source_revision_id_pipeline_version_key";
DROP INDEX IF EXISTS "organization_invitations_silo_id_last_resend_idempotency_key_key";
DROP INDEX IF EXISTS "organization_invitation_requests_silo_id_actor_subject_idempotency_key_key";
DROP INDEX IF EXISTS "user_onboarding_bootstrap_content_revisions_archetype_revision_key";
DROP INDEX IF EXISTS "user_onboarding_bootstrap_content_revisions_primary_colour_revision_key";
DROP INDEX IF EXISTS "user_onboarding_bootstrap_answers_conversation_id_question_ordinal_key";
DROP INDEX IF EXISTS "user_onboarding_bootstrap_answers_conversation_id_idempotency_key";
ALTER TABLE "agent_revision_integration_assignments" DROP CONSTRAINT IF EXISTS "agent_revision_integration_assignments_tool_definitions_check";
DROP TRIGGER IF EXISTS "run_outbox_events_monotonic" ON "run_outbox_events";
DROP FUNCTION IF EXISTS "select_artifact_preprocess_claim_candidate"();
DROP FUNCTION IF EXISTS "has_reviewed_tool_definitions"(JSONB);
DROP FUNCTION IF EXISTS "enforce_integration_lifecycle"();
DROP FUNCTION IF EXISTS "enforce_integration_custody_lifecycle"();
DROP FUNCTION IF EXISTS "enforce_agent_revision_integration_assignment_authority"();
DROP TRIGGER IF EXISTS "artifact_preprocess_jobs_closed_lifecycle" ON "artifact_preprocess_jobs";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "agent_runs"
         WHERE "state" IN ('assigned', 'running', 'waiting_for_input', 'recovery_required', 'cancelling')
    ) THEN
        RAISE EXCEPTION '0.10.0 cannot replace an AgentRun already owned by the retired runtime; finish or cancel it before migrating'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

-- The 0.10.0 cutover permanently deletes data that the removed SQL and Obot runtimes can no longer process.
DELETE FROM "run_outbox_events" WHERE "kind"::text IN ('run.attempt_requested', 'run.workload_release_requested');
DELETE FROM "agent_revision_integration_assignments";
DELETE FROM "integration_custody_references";
DELETE FROM "integrations";
DELETE FROM "mcpb_validation_claims";
DELETE FROM "mcpb_validations";

-- Existing pre-workflow preprocessing jobs retain history but cannot resume through the retired SQL poller.
UPDATE "artifact_upload_leases" lease
   SET "state" = 'cancelled'
 WHERE lease."state" IN ('active', 'promoted')
   AND EXISTS (SELECT 1 FROM "artifact_preprocess_jobs" job WHERE job."output_lease_id" = lease."id" AND job."state" IN ('pending', 'claimed', 'retryable_failed'));
UPDATE "artifact_preprocess_jobs"
   SET "state" = 'terminal_failed', "claim_fence" = NULL, "claim_expires_at" = NULL,
       "next_attempt_at" = NULL, "failure_code" = 'pre_0_10_workflow_cutover',
       "output_lease_id" = NULL, "completed_at" = NULL
 WHERE "state" IN ('pending', 'claimed', 'retryable_failed');
UPDATE "artifact_preprocess_jobs" SET "claim_fence" = NULL;

-- CreateEnum
CREATE TYPE "OciImageValidationState" AS ENUM ('pending', 'imported', 'rejected');

-- CreateEnum
CREATE TYPE "McpServerRevisionState" AS ENUM ('discovering', 'ready', 'rejected');

-- CreateEnum
CREATE TYPE "McpRuntimeExecutionKind" AS ENUM ('discovery', 'invocation');

-- CreateEnum
CREATE TYPE "McpExecutorWorkloadState" AS ENUM ('pending', 'assigned', 'released', 'registered', 'closed');

-- CreateEnum
CREATE TYPE "McpExecutorCommandState" AS ENUM ('pending', 'claimed', 'succeeded', 'failed', 'recovery_required');

-- CreateEnum
CREATE TYPE "SkillAuthoringValidationState" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "SkillAuthoringValidationCompletionOutcome" AS ENUM ('succeeded', 'failed');

-- CreateEnum
CREATE TYPE "SkillAuthoringValidationWorkloadClass" AS ENUM ('skill_authoring_validation');

-- AlterEnum
ALTER TYPE "McpServerTransport" ADD VALUE 'oci-image';

-- AlterEnum
CREATE TYPE "RunOutboxEventKind_new" AS ENUM ('run.accepted', 'run.workload_cleanup_requested', 'run.cancellation_requested', 'run.resume_requested');
ALTER TABLE "run_outbox_events" ALTER COLUMN "kind" TYPE "RunOutboxEventKind_new" USING ("kind"::text::"RunOutboxEventKind_new");
ALTER TYPE "RunOutboxEventKind" RENAME TO "RunOutboxEventKind_old";
ALTER TYPE "RunOutboxEventKind_new" RENAME TO "RunOutboxEventKind";
DROP TYPE "RunOutboxEventKind_old";

-- DropForeignKey
ALTER TABLE "agent_revision_integration_assignments" DROP CONSTRAINT "agent_revision_integration_assignments_agent_revision_id_fkey";

-- DropForeignKey
ALTER TABLE "agent_revision_integration_assignments" DROP CONSTRAINT "agent_revision_integration_assignments_integration_id_silo_fkey";

-- DropForeignKey
ALTER TABLE "agent_revision_integration_assignments" DROP CONSTRAINT "agent_revision_integration_assignments_custody_reference_i_fkey";

-- DropForeignKey
ALTER TABLE "integration_custody_references" DROP CONSTRAINT "integration_custody_references_integration_id_silo_id_fkey";

-- AlterTable
ALTER TABLE "artifact_preprocess_jobs" RENAME COLUMN "attempt" TO "delivery_count";
ALTER TABLE "artifact_preprocess_jobs" ADD COLUMN     "bootstrap_namespace" TEXT,
ADD COLUMN     "bootstrap_reference_hash" TEXT,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "completion_consumed_at" TIMESTAMP(3),
ADD COLUMN     "completion_digest" TEXT,
ADD COLUMN     "first_pod_uid" TEXT,
ADD COLUMN     "profile_name" TEXT,
ADD COLUMN     "task_id" TEXT,
ADD COLUMN     "task_key" TEXT,
ADD COLUMN     "task_name" TEXT,
ADD COLUMN     "workload_uid" TEXT;

-- AlterTable
ALTER TABLE "run_input_snapshots" DROP COLUMN "integration_assignments",
ADD COLUMN     "mcp_tools" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "run_input_snapshots" ALTER COLUMN "mcp_tools" DROP DEFAULT;

-- Carry Prisma's nullable 0.10.0 column shape into upgraded databases.
ALTER TABLE "model_definitions" ALTER COLUMN "generated_output_capabilities" DROP NOT NULL;

-- DropTable
DROP TABLE "agent_revision_integration_assignments";

-- DropTable
DROP TABLE "integrations";

-- DropTable
DROP TABLE "integration_custody_references";

-- DropTable
DROP TABLE "mcpb_validation_claims";

-- DropTable
DROP TABLE "mcpb_validations";

-- DropEnum
DROP TYPE "IntegrationState";

-- DropEnum
DROP TYPE "IntegrationCustodyState";

-- DropEnum
DROP TYPE "McpbValidationState";

-- CreateTable
CREATE TABLE "agent_revision_mcp_tool_assignments" (
    "agent_revision_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "tool_revision_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,

    CONSTRAINT "agent_revision_mcp_tool_assignments_pkey" PRIMARY KEY ("agent_revision_id","tool_revision_id")
);

-- CreateTable
CREATE TABLE "mcp_tool_admission_claims" (
    "agent_revision_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "touched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_tool_admission_claims_pkey" PRIMARY KEY ("agent_revision_id","silo_id")
);

-- CreateTable
CREATE TABLE "oci_image_validation_claims" (
    "silo_id" TEXT NOT NULL,
    "identity_digest" TEXT NOT NULL,
    "touched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oci_image_validation_claims_pkey" PRIMARY KEY ("silo_id","identity_digest")
);

-- CreateTable
CREATE TABLE "oci_image_validations" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "artifact_revision_id" TEXT NOT NULL,
    "content_address" TEXT NOT NULL,
    "byte_length" BIGINT NOT NULL,
    "media_type" TEXT NOT NULL,
    "submission_key_digest" TEXT NOT NULL,
    "submission_digest" TEXT NOT NULL,
    "state" "OciImageValidationState" NOT NULL DEFAULT 'pending',
    "index_digest" TEXT,
    "image_manifest_digest" TEXT,
    "config_digest" TEXT,
    "registry_reference" TEXT,
    "failure_code" TEXT,
    "created_by_principal_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oci_image_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_revisions" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "mcp_server_id" TEXT NOT NULL,
    "oci_image_validation_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "registry_reference" TEXT NOT NULL,
    "protocol_version" TEXT,
    "state" "McpServerRevisionState" NOT NULL DEFAULT 'discovering',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_tool_revisions" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "server_revision_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "input_schema" JSONB NOT NULL,
    "input_schema_digest" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_tool_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_runtime_executions" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "server_revision_id" TEXT NOT NULL,
    "tool_invocation_id" TEXT,
    "kind" "McpRuntimeExecutionKind" NOT NULL,
    "workload_state" "McpExecutorWorkloadState" NOT NULL DEFAULT 'pending',
    "command_state" "McpExecutorCommandState" NOT NULL DEFAULT 'pending',
    "idempotency_key" TEXT NOT NULL,
    "execution_reference" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "delivery_count" INTEGER NOT NULL DEFAULT 0,
    "claim_expires_at" TIMESTAMP(3),
    "workload_uid" TEXT,
    "assigned_at" TIMESTAMP(3),
    "release_claimed_at" TIMESTAMP(3),
    "release_delivery_count" INTEGER NOT NULL DEFAULT 0,
    "release_expires_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "pod_uid" TEXT,
    "companion_claim_fence" TEXT,
    "companion_claim_expires_at" TIMESTAMP(3),
    "tool_invocation_claim_fence" INTEGER,
    "tool_invocation_claim_revision" INTEGER,
    "terminal_outcome" TEXT,
    "terminal_payload_digest" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_runtime_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_workflow_tasks" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "silo_id" TEXT NOT NULL,
    "task_key" TEXT NOT NULL,
    "task_name" TEXT NOT NULL,
    "task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receipt_bound_at" TIMESTAMP(3),
    "assignment_expires_at" TIMESTAMP(3),
    "release_claimed_at" TIMESTAMP(3),
    "release_expires_at" TIMESTAMP(3),
    "release_delivery_count" INTEGER NOT NULL DEFAULT 0,
    "attempt_key_digest" TEXT,

    CONSTRAINT "agent_run_workflow_tasks_pkey" PRIMARY KEY ("run_id","attempt")
);

-- Create the Absurd queues before carrying unstarted AgentRuns into the new worker path.
SELECT absurd.create_queue('artifact-preprocessing');
SELECT absurd.create_queue('skill-authoring');
SELECT absurd.create_queue('agent-runs');

WITH candidates AS (
    SELECT run."id" AS "run_id", run."attempt", run."silo_id",
           'agent-run:' || run."silo_id" || ':' || run."id" || ':attempt:' || run."attempt"::TEXT AS "task_key"
      FROM "agent_runs" run
     WHERE run."state" IN ('accepted', 'queued')
), spawned AS (
    SELECT candidate.*, receipt."task_id"::TEXT
      FROM candidates candidate
      CROSS JOIN LATERAL absurd.spawn_task(
          'agent-runs',
          'agent-runs.execute/v1',
          jsonb_build_object(
              'idempotencyKey', candidate."task_key",
              'input', jsonb_build_object('siloId', candidate."silo_id", 'runId', candidate."run_id", 'attempt', candidate."attempt"),
              'inputUndefined', FALSE
          ),
          jsonb_build_object(
              'idempotency_key', array_to_json(ARRAY['agent-runs.execute/v1', candidate."task_key"])::TEXT,
              'max_attempts', 3,
              'retry_strategy', jsonb_build_object('kind', 'exponential', 'base_seconds', 30, 'factor', 2, 'max_seconds', 300)
          )
      ) receipt
)
INSERT INTO "agent_run_workflow_tasks" ("run_id", "attempt", "silo_id", "task_key", "task_name", "task_id", "receipt_bound_at")
SELECT spawned."run_id", spawned."attempt", spawned."silo_id", spawned."task_key", 'agent-runs.execute/v1', spawned."task_id",
       date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3)
  FROM spawned;

-- CreateTable
CREATE TABLE "skill_authoring_validations" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "skill_revision_id" TEXT NOT NULL,
    "artifact_revision_id" TEXT NOT NULL,
    "artifact_content_address" TEXT NOT NULL,
    "task_id" TEXT,
    "task_name" TEXT,
    "task_key" TEXT NOT NULL,
    "state" "SkillAuthoringValidationState" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failure_code" TEXT,

    CONSTRAINT "skill_authoring_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_authoring_validation_workload_claims" (
    "id" TEXT NOT NULL,
    "validation_id" TEXT NOT NULL,
    "workload_class" "SkillAuthoringValidationWorkloadClass" NOT NULL,
    "profile_name" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "execution_reference" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "delivery_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "workload_uid" TEXT,
    "first_pod_uid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_authoring_validation_workload_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_authoring_validation_bootstraps" (
    "id" TEXT NOT NULL,
    "validation_id" TEXT NOT NULL,
    "reference_hash" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "service_account" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_by_pod_uid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_authoring_validation_bootstraps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_authoring_validation_completion_inbox" (
    "id" TEXT NOT NULL,
    "validation_id" TEXT NOT NULL,
    "completion_digest" TEXT NOT NULL,
    "outcome" "SkillAuthoringValidationCompletionOutcome" NOT NULL,
    "test_report" JSONB,
    "scan_result" JSONB,
    "failure_code" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_authoring_validation_completion_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_authoring_validation_workflow_event_outbox" (
    "id" TEXT NOT NULL,
    "completion_inbox_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "publication_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_authoring_validation_workflow_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_revision_mcp_tool_assignments_agent_service_id_silo_i_idx" ON "agent_revision_mcp_tool_assignments"("agent_service_id", "silo_id");

-- CreateIndex
CREATE INDEX "agent_revision_mcp_tool_assignments_tool_revision_id_silo_i_idx" ON "agent_revision_mcp_tool_assignments"("tool_revision_id", "silo_id");

-- CreateIndex
CREATE INDEX "oci_image_validations_silo_id_state_created_at_idx" ON "oci_image_validations"("silo_id", "state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "oci_image_validations_silo_id_submission_key_digest_key" ON "oci_image_validations"("silo_id", "submission_key_digest");

-- CreateIndex
CREATE UNIQUE INDEX "oci_image_validations_id_silo_id_key" ON "oci_image_validations"("id", "silo_id");

-- CreateIndex
CREATE INDEX "mcp_server_revisions_silo_id_state_idx" ON "mcp_server_revisions"("silo_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_revisions_mcp_server_id_revision_key" ON "mcp_server_revisions"("mcp_server_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_revisions_oci_image_validation_id_silo_id_key" ON "mcp_server_revisions"("oci_image_validation_id", "silo_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_revisions_silo_id_registry_reference_key" ON "mcp_server_revisions"("silo_id", "registry_reference");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_revisions_id_silo_id_key" ON "mcp_server_revisions"("id", "silo_id");

-- CreateIndex
CREATE INDEX "mcp_tool_revisions_silo_id_name_idx" ON "mcp_tool_revisions"("silo_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tool_revisions_server_revision_id_name_key" ON "mcp_tool_revisions"("server_revision_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tool_revisions_id_silo_id_key" ON "mcp_tool_revisions"("id", "silo_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_runtime_executions_tool_invocation_id_key" ON "mcp_runtime_executions"("tool_invocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_runtime_executions_idempotency_key_key" ON "mcp_runtime_executions"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_runtime_executions_execution_reference_key" ON "mcp_runtime_executions"("execution_reference");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_runtime_executions_workload_uid_key" ON "mcp_runtime_executions"("workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_runtime_executions_pod_uid_key" ON "mcp_runtime_executions"("pod_uid");

-- CreateIndex
CREATE INDEX "mcp_runtime_executions_workload_state_claim_expires_at_crea_idx" ON "mcp_runtime_executions"("workload_state", "claim_expires_at", "created_at");

-- CreateIndex
CREATE INDEX "mcp_runtime_executions_workload_state_release_expires_at_cr_idx" ON "mcp_runtime_executions"("workload_state", "release_expires_at", "created_at");

-- CreateIndex
CREATE INDEX "mcp_runtime_executions_command_state_companion_claim_expire_idx" ON "mcp_runtime_executions"("command_state", "companion_claim_expires_at");

-- CreateIndex
CREATE INDEX "mcp_runtime_executions_server_revision_id_kind_idx" ON "mcp_runtime_executions"("server_revision_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_workflow_tasks_task_id_key" ON "agent_run_workflow_tasks"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_workflow_tasks_silo_id_task_key_key" ON "agent_run_workflow_tasks"("silo_id", "task_key");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validations_task_id_key" ON "skill_authoring_validations"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validations_task_key_key" ON "skill_authoring_validations"("task_key");

-- CreateIndex
CREATE INDEX "skill_authoring_validations_silo_id_state_created_at_idx" ON "skill_authoring_validations"("silo_id", "state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validations_skill_revision_id_artifact_revi_key" ON "skill_authoring_validations"("skill_revision_id", "artifact_revision_id", "artifact_content_address");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_workload_claims_validation_id_key" ON "skill_authoring_validation_workload_claims"("validation_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_workload_claims_idempotency_key_key" ON "skill_authoring_validation_workload_claims"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_workload_claims_workload_uid_key" ON "skill_authoring_validation_workload_claims"("workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_workload_claims_first_pod_uid_key" ON "skill_authoring_validation_workload_claims"("first_pod_uid");

-- CreateIndex
CREATE INDEX "skill_authoring_validation_workload_claims_claimed_at_expir_idx" ON "skill_authoring_validation_workload_claims"("claimed_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_bootstraps_validation_id_key" ON "skill_authoring_validation_bootstraps"("validation_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_bootstraps_reference_hash_key" ON "skill_authoring_validation_bootstraps"("reference_hash");

-- CreateIndex
CREATE INDEX "skill_authoring_validation_bootstraps_expires_at_idx" ON "skill_authoring_validation_bootstraps"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_completion_inbox_validation_id_key" ON "skill_authoring_validation_completion_inbox"("validation_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_authoring_validation_workflow_event_outbox_completion_key" ON "skill_authoring_validation_workflow_event_outbox"("completion_inbox_id");

-- CreateIndex
CREATE INDEX "skill_authoring_validation_workflow_event_outbox_published__idx" ON "skill_authoring_validation_workflow_event_outbox"("published_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_task_id_key" ON "artifact_preprocess_jobs"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_task_key_key" ON "artifact_preprocess_jobs"("task_key");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_claim_fence_key" ON "artifact_preprocess_jobs"("claim_fence");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_workload_uid_key" ON "artifact_preprocess_jobs"("workload_uid");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_first_pod_uid_key" ON "artifact_preprocess_jobs"("first_pod_uid");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_bootstrap_reference_hash_key" ON "artifact_preprocess_jobs"("bootstrap_reference_hash");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_preprocess_jobs_completion_digest_key" ON "artifact_preprocess_jobs"("completion_digest");

-- CreateIndex
CREATE INDEX "artifact_preprocess_jobs_claimed_at_claim_expires_at_idx" ON "artifact_preprocess_jobs"("claimed_at", "claim_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_id_silo_id_key" ON "mcp_servers"("id", "silo_id");

-- AddForeignKey
ALTER TABLE "agent_revision_mcp_tool_assignments" ADD CONSTRAINT "agent_revision_mcp_tool_assignments_agent_service_id_agent_fkey" FOREIGN KEY ("agent_service_id", "agent_revision_id") REFERENCES "agent_revisions"("agent_service_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_mcp_tool_assignments" ADD CONSTRAINT "agent_revision_mcp_tool_assignments_agent_service_id_silo__fkey" FOREIGN KEY ("agent_service_id", "silo_id") REFERENCES "agent_services"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_revision_mcp_tool_assignments" ADD CONSTRAINT "agent_revision_mcp_tool_assignments_tool_revision_id_silo__fkey" FOREIGN KEY ("tool_revision_id", "silo_id") REFERENCES "mcp_tool_revisions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_revisions" ADD CONSTRAINT "mcp_server_revisions_mcp_server_id_silo_id_fkey" FOREIGN KEY ("mcp_server_id", "silo_id") REFERENCES "mcp_servers"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_revisions" ADD CONSTRAINT "mcp_server_revisions_oci_image_validation_id_silo_id_fkey" FOREIGN KEY ("oci_image_validation_id", "silo_id") REFERENCES "oci_image_validations"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tool_revisions" ADD CONSTRAINT "mcp_tool_revisions_server_revision_id_silo_id_fkey" FOREIGN KEY ("server_revision_id", "silo_id") REFERENCES "mcp_server_revisions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_runtime_executions" ADD CONSTRAINT "mcp_runtime_executions_server_revision_id_silo_id_fkey" FOREIGN KEY ("server_revision_id", "silo_id") REFERENCES "mcp_server_revisions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_runtime_executions" ADD CONSTRAINT "mcp_runtime_executions_tool_invocation_id_fkey" FOREIGN KEY ("tool_invocation_id") REFERENCES "tool_invocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_workflow_tasks" ADD CONSTRAINT "agent_run_workflow_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_authoring_validations" ADD CONSTRAINT "skill_authoring_validations_skill_revision_id_fkey" FOREIGN KEY ("skill_revision_id") REFERENCES "skill_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_authoring_validation_workload_claims" ADD CONSTRAINT "skill_authoring_validation_workload_claims_validation_id_fkey" FOREIGN KEY ("validation_id") REFERENCES "skill_authoring_validations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_authoring_validation_bootstraps" ADD CONSTRAINT "skill_authoring_validation_bootstraps_validation_id_fkey" FOREIGN KEY ("validation_id") REFERENCES "skill_authoring_validations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_authoring_validation_completion_inbox" ADD CONSTRAINT "skill_authoring_validation_completion_inbox_validation_id_fkey" FOREIGN KEY ("validation_id") REFERENCES "skill_authoring_validations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_authoring_validation_workflow_event_outbox" ADD CONSTRAINT "skill_authoring_validation_workflow_event_outbox_completio_fkey" FOREIGN KEY ("completion_inbox_id") REFERENCES "skill_authoring_validation_completion_inbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restore triggers and functions because Prisma's generated table diff does not include these rules.
CREATE OR REPLACE FUNCTION "enforce_agent_run_authority_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
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
            (OLD."state" = 'running' AND NEW."state" IN ('waiting_for_input', 'completed', 'failed', 'cancelling')) OR
            (OLD."state" = 'waiting_for_input' AND NEW."state" IN ('running', 'completed', 'failed', 'cancelling')) OR
            (OLD."state" = 'cancelling' AND NEW."state" = 'cancelled')
        ) THEN
            RAISE EXCEPTION 'invalid AgentRun state transition';
        END IF;
        IF OLD."state" = 'cancelling' AND NEW."state" = 'cancelled' THEN
            PERFORM 1 FROM "workload_assignments" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            PERFORM 1 FROM "run_proof_keys" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            PERFORM 1 FROM "agent_run_workflow_tasks" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
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
                SELECT 1 FROM "agent_run_workflow_tasks"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "task_id" IS NOT NULL
            ) AND NOT EXISTS (
                SELECT 1 FROM "run_outbox_events"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "kind" = 'run.workload_cleanup_requested'::"RunOutboxEventKind"
                  AND "published_at" IS NOT NULL AND "failed_at" IS NULL
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun with a bound workflow task requires a confirmed WorkloadCleanup';
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

CREATE OR REPLACE FUNCTION "enforce_personal_configuration_change_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_silo TEXT; profile_user TEXT; active_persona TEXT; conversation_silo TEXT; conversation_service TEXT; conversation_mode "ConversationMode";
        run_silo TEXT; run_conversation TEXT; run_service TEXT; run_user TEXT; service_silo TEXT; service_kind "AgentServiceKind"; active_agent TEXT;
        refresh_change TEXT; applied_revision_profile TEXT; applied_revision_service TEXT; applied_revision_parent TEXT; applied_model_alias TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PersonalConfigurationChange rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'proposed' THEN RAISE EXCEPTION 'PersonalConfigurationChange must begin as Proposed'; END IF;
        SELECT "silo_id", "user_id", "active_revision_id" INTO profile_silo, profile_user, active_persona
          FROM "persona_profiles" WHERE "id" = NEW."persona_profile_id" FOR UPDATE;
        SELECT "silo_id", "agent_service_id", "mode" INTO conversation_silo, conversation_service, conversation_mode
          FROM "conversations" WHERE "id" = NEW."source_conversation_id" FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM "conversation_participants" WHERE "conversation_id" = NEW."source_conversation_id" AND "user_id" = NEW."user_id" AND "access_ended_position" IS NULL) THEN
            RAISE EXCEPTION 'PersonalConfigurationChange source conversation requires the initiating participant with current access';
        END IF;
        SELECT "silo_id", "conversation_id", "agent_service_id", "delegated_user_id" INTO run_silo, run_conversation, run_service, run_user
          FROM "agent_runs" WHERE "id" = NEW."source_run_id" FOR UPDATE;
        SELECT "silo_id", "kind", "active_revision_id" INTO service_silo, service_kind, active_agent
          FROM "agent_services" WHERE "id" = NEW."agent_service_id" FOR UPDATE;
        IF profile_silo IS DISTINCT FROM NEW."silo_id" OR profile_user IS DISTINCT FROM NEW."user_id"
           OR conversation_silo IS DISTINCT FROM NEW."silo_id" OR conversation_service IS DISTINCT FROM NEW."agent_service_id" OR conversation_mode IS DISTINCT FROM 'agent_session'
           OR run_silo IS DISTINCT FROM NEW."silo_id" OR run_conversation IS DISTINCT FROM NEW."source_conversation_id"
           OR run_service IS DISTINCT FROM NEW."agent_service_id" OR run_user IS DISTINCT FROM NEW."user_id"
           OR service_silo IS DISTINCT FROM NEW."silo_id" OR service_kind IS DISTINCT FROM 'personal'
           OR active_persona IS DISTINCT FROM NEW."expected_persona_revision_id" OR active_agent IS DISTINCT FROM NEW."expected_agent_revision_id" THEN
            RAISE EXCEPTION 'PersonalConfigurationChange provenance or active-revision fence conflict';
        END IF;
        IF NEW."source_message_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "conversation_messages" WHERE "id" = NEW."source_message_id" AND "conversation_id" = NEW."source_conversation_id") THEN
            RAISE EXCEPTION 'PersonalConfigurationChange source message must belong to its source conversation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
       OR NEW."persona_profile_id" IS DISTINCT FROM OLD."persona_profile_id" OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
       OR NEW."source_conversation_id" IS DISTINCT FROM OLD."source_conversation_id" OR NEW."source_run_id" IS DISTINCT FROM OLD."source_run_id"
       OR NEW."source_message_id" IS DISTINCT FROM OLD."source_message_id" OR NEW."requested_patch" IS DISTINCT FROM OLD."requested_patch"
       OR NEW."requested_patch_digest" IS DISTINCT FROM OLD."requested_patch_digest" OR NEW."expected_persona_revision_id" IS DISTINCT FROM OLD."expected_persona_revision_id"
       OR NEW."expected_agent_revision_id" IS DISTINCT FROM OLD."expected_agent_revision_id" OR NEW."proposed_at" IS DISTINCT FROM OLD."proposed_at" THEN
        RAISE EXCEPTION 'PersonalConfigurationChange proposal evidence is immutable';
    END IF;
    IF OLD."state" <> 'proposed' AND (NEW."decided_at" IS DISTINCT FROM OLD."decided_at" OR NEW."decided_by" IS DISTINCT FROM OLD."decided_by" OR NEW."rejection_reason" IS DISTINCT FROM OLD."rejection_reason") THEN
        RAISE EXCEPTION 'PersonalConfigurationChange decision evidence is immutable';
    END IF;
    IF OLD."state" = 'proposed' AND NEW."state" IN ('accepted', 'rejected') THEN RETURN NEW; END IF;
    IF OLD."state" = 'accepted' AND NEW."state" = 'applied' THEN
        IF NEW."requested_patch" = '{"kind":"persona_refresh"}'::jsonb THEN
            IF NEW."applied_persona_revision_id" IS NULL OR NEW."applied_agent_revision_id" IS NOT NULL THEN
                RAISE EXCEPTION 'persona_refresh requires an approved persona revision only';
            END IF;
            SELECT revision."persona_profile_id", interview."refresh_configuration_change_id"
              INTO applied_revision_profile, refresh_change
              FROM "persona_revisions" revision JOIN "persona_interviews" interview ON interview."id" = revision."interview_id"
              WHERE revision."id" = NEW."applied_persona_revision_id" AND revision."state" = 'approved' FOR UPDATE OF revision, interview;
            IF applied_revision_profile IS DISTINCT FROM NEW."persona_profile_id" OR refresh_change IS DISTINCT FROM NEW."id" THEN
                RAISE EXCEPTION 'applied persona refresh must use its exact approved interview-derived revision';
            END IF;
        ELSIF NEW."requested_patch"->>'kind' = 'model_alias' THEN
            IF NEW."applied_persona_revision_id" IS NOT NULL OR NEW."applied_agent_revision_id" IS NULL THEN
                RAISE EXCEPTION 'model_alias requires a published personal AgentRevision only';
            END IF;
            SELECT profile."active_revision_id" INTO active_persona
              FROM "persona_profiles" profile
              WHERE profile."id" = NEW."persona_profile_id" AND profile."silo_id" = NEW."silo_id" AND profile."user_id" = NEW."user_id"
              FOR UPDATE OF profile;
            IF active_persona IS DISTINCT FROM NEW."expected_persona_revision_id" THEN
                RAISE EXCEPTION 'applied model_alias must preserve the proposal persona revision';
            END IF;
            SELECT revision."agent_service_id", revision."parent_revision_id", definition."public_model_name"
              INTO applied_revision_service, applied_revision_parent, applied_model_alias
              FROM "agent_revisions" revision JOIN "model_definitions" definition ON definition."id" = revision."model_definition_id"
              WHERE revision."id" = NEW."applied_agent_revision_id" AND revision."state" = 'published' FOR UPDATE OF revision, definition;
            IF applied_revision_service IS DISTINCT FROM NEW."agent_service_id" OR applied_revision_parent IS DISTINCT FROM NEW."expected_agent_revision_id"
               OR applied_model_alias IS DISTINCT FROM NEW."requested_patch"->>'modelAlias'
               OR NOT EXISTS (SELECT 1 FROM "agent_services" service WHERE service."id" = NEW."agent_service_id" AND service."kind" = 'personal' AND service."state" = 'active' AND service."active_revision_id" = NEW."applied_agent_revision_id") THEN
                RAISE EXCEPTION 'applied model_alias must activate its exact published personal AgentRevision';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "agent_revisions" child JOIN "agent_revisions" parent ON parent."id" = NEW."expected_agent_revision_id"
                WHERE child."id" = NEW."applied_agent_revision_id" AND (
                    child."prompt_policy_version" IS DISTINCT FROM parent."prompt_policy_version"
                    OR child."persona_revision_id" IS DISTINCT FROM parent."persona_revision_id"
                    OR child."persona_revision_id" IS DISTINCT FROM active_persona
                    OR child."budget" IS DISTINCT FROM parent."budget"
                )
            ) OR EXISTS (
                (SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
                 EXCEPT SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
                UNION ALL
                (SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
                 EXCEPT SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) OR EXISTS (
				(SELECT "tool_revision_id", "agent_service_id", "silo_id" FROM "agent_revision_mcp_tool_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
				 EXCEPT SELECT "tool_revision_id", "agent_service_id", "silo_id" FROM "agent_revision_mcp_tool_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
				UNION ALL
				(SELECT "tool_revision_id", "agent_service_id", "silo_id" FROM "agent_revision_mcp_tool_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
				 EXCEPT SELECT "tool_revision_id", "agent_service_id", "silo_id" FROM "agent_revision_mcp_tool_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) OR EXISTS (
				(SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
				 EXCEPT SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
				UNION ALL
				(SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
				 EXCEPT SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) THEN
                RAISE EXCEPTION 'applied model_alias may change only its model definition';
            END IF;
        ELSE
            RAISE EXCEPTION 'PersonalConfigurationChange has an unsupported applied patch';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PersonalConfigurationChange has an invalid lifecycle transition';
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_artifact_preprocess_job_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_state "ArtifactRevisionState"; source_media_type TEXT; source_silo_id TEXT; source_owner_principal_id TEXT; source_artifact_state "ArtifactState";
        output_silo_id TEXT; output_owner_principal_id TEXT; output_kind "ArtifactKind"; output_state "ArtifactState"; output_revision_artifact_id TEXT; output_revision_media_type TEXT; output_revision_state "ArtifactRevisionState"; output_revision_address TEXT; output_revision_length BIGINT;
        output_lease_artifact_id TEXT; output_lease_state "ArtifactUploadLeaseState"; output_lease_address TEXT; output_lease_length BIGINT; output_lease_media_type TEXT; output_lease_expires_at TIMESTAMP(3); output_lease_promoted_address TEXT; output_lease_promoted_length BIGINT;
        delivery_changed BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ArtifactPreprocessJob rows cannot be deleted'; END IF;
    SELECT revision."state", revision."media_type", artifact."silo_id", artifact."owner_principal_id", artifact."state" INTO source_state, source_media_type, source_silo_id, source_owner_principal_id, source_artifact_state
      FROM "artifact_revisions" revision JOIN "artifacts" artifact ON artifact."id" = revision."artifact_id" WHERE revision."id" = NEW."source_revision_id" FOR UPDATE OF revision, artifact;
    IF source_state IS DISTINCT FROM 'published' OR source_artifact_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'ArtifactPreprocessJob source must remain active and Published'; END IF;
    IF NEW."pipeline_version" <> 'pdf-to-text/v1' OR source_media_type <> 'application/pdf' THEN RAISE EXCEPTION 'ArtifactPreprocessJob requires the supported PDF pipeline'; END IF;
    IF NEW."derived_artifact_id" IS NOT NULL THEN
        SELECT "silo_id", "owner_principal_id", "kind", "state" INTO output_silo_id, output_owner_principal_id, output_kind, output_state FROM "artifacts" WHERE "id" = NEW."derived_artifact_id" FOR UPDATE;
        IF output_silo_id IS DISTINCT FROM source_silo_id OR output_owner_principal_id IS DISTINCT FROM source_owner_principal_id OR output_kind IS DISTINCT FROM 'generated' OR output_state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'ArtifactPreprocessJob derived Artifact must retain the active source owner and silo'; END IF;
    END IF;
    IF NEW."derived_revision_id" IS NOT NULL THEN
        SELECT "artifact_id", "media_type", "state", "content_address", "byte_length" INTO output_revision_artifact_id, output_revision_media_type, output_revision_state, output_revision_address, output_revision_length FROM "artifact_revisions" WHERE "id" = NEW."derived_revision_id" FOR UPDATE;
        IF output_revision_artifact_id IS DISTINCT FROM NEW."derived_artifact_id" OR output_revision_media_type <> 'text/plain' OR output_revision_state IS DISTINCT FROM 'published' THEN RAISE EXCEPTION 'ArtifactPreprocessJob derived revision must be published text for its output Artifact'; END IF;
    END IF;
    IF NEW."output_lease_id" IS NOT NULL THEN
        SELECT "artifact_id", "state", "expected_content_address", "expected_byte_length", "media_type", "expires_at", "promoted_content_address", "promoted_byte_length" INTO output_lease_artifact_id, output_lease_state, output_lease_address, output_lease_length, output_lease_media_type, output_lease_expires_at, output_lease_promoted_address, output_lease_promoted_length FROM "artifact_upload_leases" WHERE "id" = NEW."output_lease_id" FOR UPDATE;
        IF output_lease_artifact_id IS DISTINCT FROM NEW."derived_artifact_id" OR output_lease_address IS NULL OR output_lease_length IS NULL OR output_lease_media_type <> 'text/plain' THEN RAISE EXCEPTION 'ArtifactPreprocessJob output lease must bind exact text output for its derived Artifact'; END IF;
        IF NEW."state" = 'claimed' AND NEW."completion_digest" IS NULL AND (output_lease_state IS DISTINCT FROM 'active' OR output_lease_expires_at > NEW."claim_expires_at") THEN RAISE EXCEPTION 'ArtifactPreprocessJob claimed output lease must remain active within its claim'; END IF;
        IF NEW."state" = 'claimed' AND NEW."completion_digest" IS NOT NULL AND (output_lease_state IS DISTINCT FROM 'finalized' OR output_lease_promoted_address IS DISTINCT FROM output_lease_address OR output_lease_promoted_length IS DISTINCT FROM output_lease_length OR output_lease_promoted_address IS DISTINCT FROM output_revision_address OR output_lease_promoted_length IS DISTINCT FROM output_revision_length) THEN RAISE EXCEPTION 'ArtifactPreprocessJob completion evidence requires its finalized exact output lease'; END IF;
        IF NEW."state" = 'completed' AND (output_lease_state IS DISTINCT FROM 'finalized' OR output_lease_promoted_address IS DISTINCT FROM output_lease_address OR output_lease_promoted_length IS DISTINCT FROM output_lease_length OR output_lease_promoted_address IS DISTINCT FROM output_revision_address OR output_lease_promoted_length IS DISTINCT FROM output_revision_length) THEN RAISE EXCEPTION 'ArtifactPreprocessJob completion requires its finalized exact output lease'; END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'pending' OR NEW."task_key" IS NULL OR NEW."task_key" !~ '^workflows:artifact-preprocess:[0-9a-f]{64}$' OR NEW."task_id" IS NOT NULL OR NEW."task_name" IS NOT NULL OR NEW."delivery_count" <> 0 OR NEW."claim_fence" IS NOT NULL OR NEW."profile_name" IS NOT NULL OR NEW."claimed_at" IS NOT NULL OR NEW."claim_expires_at" IS NOT NULL OR NEW."workload_uid" IS NOT NULL OR NEW."first_pod_uid" IS NOT NULL OR NEW."bootstrap_reference_hash" IS NOT NULL OR NEW."bootstrap_namespace" IS NOT NULL OR NEW."next_attempt_at" IS NOT NULL OR NEW."failure_code" IS NOT NULL OR NEW."derived_artifact_id" IS NOT NULL OR NEW."derived_revision_id" IS NOT NULL OR NEW."output_lease_id" IS NOT NULL OR NEW."completion_digest" IS NOT NULL OR NEW."completion_consumed_at" IS NOT NULL OR NEW."completed_at" IS NOT NULL THEN RAISE EXCEPTION 'ArtifactPreprocessJob must begin pending with only its stable task key'; END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."source_revision_id" IS DISTINCT FROM OLD."source_revision_id" OR NEW."pipeline_version" IS DISTINCT FROM OLD."pipeline_version" OR NEW."task_key" IS DISTINCT FROM OLD."task_key" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN RAISE EXCEPTION 'ArtifactPreprocessJob identity is immutable'; END IF;
    -- Bind the workflow receipt while pending so a later delivery cannot switch to another task.
    IF NEW."task_id" IS DISTINCT FROM OLD."task_id" OR NEW."task_name" IS DISTINCT FROM OLD."task_name" THEN
        IF OLD."state" <> 'pending' OR NEW."state" <> 'pending' OR OLD."task_id" IS NOT NULL OR OLD."task_name" IS NOT NULL OR NEW."task_id" IS NULL OR btrim(NEW."task_id") = '' OR NEW."task_name" <> 'artifacts.preprocess.pdf-to-text/v1' THEN RAISE EXCEPTION 'ArtifactPreprocessJob task receipt binds once while pending'; END IF;
    END IF;
    IF OLD."derived_artifact_id" IS NOT NULL AND NEW."derived_artifact_id" IS DISTINCT FROM OLD."derived_artifact_id" THEN RAISE EXCEPTION 'ArtifactPreprocessJob output Artifact is immutable once allocated'; END IF;
    IF OLD."derived_revision_id" IS NOT NULL AND (NEW."derived_revision_id" IS DISTINCT FROM OLD."derived_revision_id" OR NEW."completion_digest" IS DISTINCT FROM OLD."completion_digest") THEN RAISE EXCEPTION 'ArtifactPreprocessJob completion evidence is immutable once saved'; END IF;
    IF NOT ((OLD."state" = 'pending' AND NEW."state" IN ('pending', 'claimed')) OR (OLD."state" = 'retryable_failed' AND NEW."state" IN ('retryable_failed', 'claimed')) OR (OLD."state" = 'claimed' AND NEW."state" IN ('claimed', 'completed', 'retryable_failed', 'terminal_failed')) OR (OLD."state" = 'completed' AND NEW."state" = 'completed') OR (OLD."state" = 'terminal_failed' AND NEW."state" = 'terminal_failed')) THEN RAISE EXCEPTION 'invalid ArtifactPreprocessJob lifecycle transition'; END IF;
    -- Give every workflow delivery a new fence and cleared bindings so it cannot inherit the Job,
    -- Pod, bootstrap, lease, or completion evidence of an expired attempt.
    delivery_changed := NEW."delivery_count" IS DISTINCT FROM OLD."delivery_count";
    IF NEW."state" = 'pending' AND (NEW."delivery_count" <> 0 OR NEW."claim_fence" IS NOT NULL OR NEW."profile_name" IS NOT NULL OR NEW."claimed_at" IS NOT NULL OR NEW."claim_expires_at" IS NOT NULL OR NEW."workload_uid" IS NOT NULL OR NEW."first_pod_uid" IS NOT NULL OR NEW."bootstrap_reference_hash" IS NOT NULL OR NEW."bootstrap_namespace" IS NOT NULL OR NEW."next_attempt_at" IS NOT NULL OR NEW."failure_code" IS NOT NULL OR NEW."derived_artifact_id" IS NOT NULL OR NEW."derived_revision_id" IS NOT NULL OR NEW."output_lease_id" IS NOT NULL OR NEW."completion_digest" IS NOT NULL OR NEW."completion_consumed_at" IS NOT NULL OR NEW."completed_at" IS NOT NULL) THEN RAISE EXCEPTION 'ArtifactPreprocessJob pending state cannot carry delivery or output facts'; END IF;
    IF NEW."state" = 'claimed' AND delivery_changed THEN
        IF NEW."delivery_count" <> OLD."delivery_count" + 1 OR NEW."task_id" IS NULL OR NEW."task_name" <> 'artifacts.preprocess.pdf-to-text/v1' OR NEW."claim_fence" IS NULL OR NEW."claim_fence" IS NOT DISTINCT FROM OLD."claim_fence" OR NEW."profile_name" <> 'pdf-preprocessor' OR NEW."claimed_at" IS NULL OR NEW."claim_expires_at" IS NULL OR NEW."claim_expires_at" <= clock_timestamp() OR NEW."claim_expires_at" <= NEW."claimed_at" OR NEW."claim_expires_at" > NEW."claimed_at" + interval '5 minutes' OR NEW."workload_uid" IS NOT NULL OR NEW."first_pod_uid" IS NOT NULL OR NEW."bootstrap_reference_hash" IS NOT NULL OR NEW."bootstrap_namespace" IS NOT NULL OR NEW."output_lease_id" IS NOT NULL OR NEW."next_attempt_at" IS NOT NULL OR NEW."failure_code" IS NOT NULL OR NEW."derived_revision_id" IS NOT NULL OR NEW."completion_digest" IS NOT NULL OR NEW."completion_consumed_at" IS NOT NULL OR NEW."completed_at" IS NOT NULL THEN RAISE EXCEPTION 'ArtifactPreprocessJob delivery must use a fresh live bounded fence and clear delivery bindings'; END IF;
        IF OLD."state" = 'claimed' AND (OLD."claim_expires_at" IS NULL OR OLD."claim_expires_at" > clock_timestamp()) THEN RAISE EXCEPTION 'ArtifactPreprocessJob cannot replace a live delivery'; END IF;
    ELSIF delivery_changed THEN
        RAISE EXCEPTION 'ArtifactPreprocessJob delivery count changes only when a delivery is claimed';
    END IF;
    IF OLD."state" = NEW."state" AND NOT delivery_changed THEN
        IF NEW."state" = 'pending' THEN
            IF NEW."task_id" IS NOT DISTINCT FROM OLD."task_id" AND NEW."task_name" IS NOT DISTINCT FROM OLD."task_name" AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'ArtifactPreprocessJob pending state changes only by binding its task receipt'; END IF;
        ELSIF NEW."state" = 'claimed' THEN
            IF NEW."claim_fence" IS DISTINCT FROM OLD."claim_fence" OR NEW."profile_name" IS DISTINCT FROM OLD."profile_name" OR NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" OR NEW."claim_expires_at" IS DISTINCT FROM OLD."claim_expires_at" OR NEW."next_attempt_at" IS DISTINCT FROM OLD."next_attempt_at" OR NEW."failure_code" IS DISTINCT FROM OLD."failure_code" OR NEW."completion_consumed_at" IS DISTINCT FROM OLD."completion_consumed_at" OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at" THEN RAISE EXCEPTION 'ArtifactPreprocessJob delivery facts change only when a delivery is claimed'; END IF;
            IF NEW."derived_artifact_id" IS DISTINCT FROM OLD."derived_artifact_id" AND NOT (OLD."derived_artifact_id" IS NULL AND NEW."derived_artifact_id" IS NOT NULL) THEN RAISE EXCEPTION 'ArtifactPreprocessJob derived Artifact binds once'; END IF;
            IF NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid" OR NEW."bootstrap_reference_hash" IS DISTINCT FROM OLD."bootstrap_reference_hash" OR NEW."bootstrap_namespace" IS DISTINCT FROM OLD."bootstrap_namespace" THEN
                IF OLD."workload_uid" IS NOT NULL OR OLD."bootstrap_reference_hash" IS NOT NULL OR OLD."bootstrap_namespace" IS NOT NULL OR NEW."workload_uid" IS NULL OR NEW."bootstrap_reference_hash" IS NULL OR NEW."bootstrap_namespace" IS NULL THEN RAISE EXCEPTION 'ArtifactPreprocessJob workload and bootstrap bind once together'; END IF;
            END IF;
            IF NEW."first_pod_uid" IS DISTINCT FROM OLD."first_pod_uid" AND NOT (OLD."first_pod_uid" IS NULL AND NEW."first_pod_uid" IS NOT NULL AND NEW."workload_uid" IS NOT NULL) THEN RAISE EXCEPTION 'ArtifactPreprocessJob first Pod binds once after its workload'; END IF;
            IF NEW."output_lease_id" IS DISTINCT FROM OLD."output_lease_id" AND NOT (OLD."output_lease_id" IS NULL AND NEW."output_lease_id" IS NOT NULL AND NEW."derived_artifact_id" IS NOT NULL) THEN RAISE EXCEPTION 'ArtifactPreprocessJob output lease binds once per delivery'; END IF;
            IF NEW."derived_revision_id" IS DISTINCT FROM OLD."derived_revision_id" OR NEW."completion_digest" IS DISTINCT FROM OLD."completion_digest" THEN
                -- Save worker output while the delivery is still claimed; the controller consumes
                -- this evidence in the separate claimed-to-completed transition below.
                IF OLD."derived_revision_id" IS NOT NULL OR OLD."completion_digest" IS NOT NULL OR NEW."derived_revision_id" IS NULL OR NEW."completion_digest" IS NULL OR NEW."output_lease_id" IS NULL OR NEW."workload_uid" IS NULL OR NEW."first_pod_uid" IS NULL THEN RAISE EXCEPTION 'ArtifactPreprocessJob completion evidence binds once after its worker output'; END IF;
            END IF;
        ELSIF NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'ArtifactPreprocessJob terminal state is immutable';
        END IF;
    END IF;
    IF OLD."state" = 'claimed' AND NEW."state" IN ('retryable_failed', 'terminal_failed') THEN
        IF OLD."claim_fence" IS NULL OR OLD."claim_expires_at" IS NULL OR (OLD."claim_expires_at" <= clock_timestamp() AND NEW."failure_code" <> 'claim_expired') THEN RAISE EXCEPTION 'ArtifactPreprocessJob failure requires its current delivery or claim_expired evidence'; END IF;
        IF NEW."delivery_count" <> OLD."delivery_count" OR NEW."claim_fence" IS DISTINCT FROM OLD."claim_fence" OR NEW."derived_artifact_id" IS NULL OR NEW."derived_revision_id" IS NOT NULL OR NEW."output_lease_id" IS NOT NULL OR NEW."completion_digest" IS NOT NULL OR NEW."completion_consumed_at" IS NOT NULL OR NEW."failure_code" IS NULL OR NEW."completed_at" IS NOT NULL OR (NEW."state" = 'retryable_failed' AND NEW."next_attempt_at" IS NULL) OR (NEW."state" = 'terminal_failed' AND NEW."next_attempt_at" IS NOT NULL) THEN RAISE EXCEPTION 'ArtifactPreprocessJob failure requires bounded retry or terminal evidence'; END IF;
    END IF;
    IF OLD."state" = 'claimed' AND NEW."state" = 'completed' THEN
        IF NEW."delivery_count" <> OLD."delivery_count" OR NEW."claim_fence" IS DISTINCT FROM OLD."claim_fence" OR NEW."workload_uid" IS NULL OR NEW."first_pod_uid" IS NULL OR NEW."derived_artifact_id" IS NULL OR NEW."derived_revision_id" IS NULL OR NEW."output_lease_id" IS NULL OR NEW."completion_digest" IS NULL OR NEW."completion_consumed_at" IS NULL OR NEW."completed_at" IS NULL OR NEW."failure_code" IS NOT NULL OR NEW."next_attempt_at" IS NOT NULL THEN RAISE EXCEPTION 'ArtifactPreprocessJob completion requires consumed fenced worker evidence'; END IF;
        IF NOT EXISTS (SELECT 1 FROM "artifact_revision_parents" WHERE "child_revision_id" = NEW."derived_revision_id" AND "parent_revision_id" = NEW."source_revision_id") THEN RAISE EXCEPTION 'ArtifactPreprocessJob completion requires immutable source lineage'; END IF;
    END IF;
    IF OLD."state" = 'claimed' AND (NEW."state" IN ('retryable_failed', 'terminal_failed') OR delivery_changed) AND OLD."output_lease_id" IS NOT NULL THEN
        UPDATE "artifact_upload_leases" SET "state" = 'cancelled' WHERE "id" = OLD."output_lease_id" AND "state" IN ('active', 'promoted');
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_artifact_preprocess_claim_completeness"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_job "artifact_preprocess_jobs"%ROWTYPE;
BEGIN
    -- Check at transaction end so claiming may allocate the derived Artifact in the same commit,
    -- while still rejecting a claimed delivery that lacks its task, derived Artifact, or live claim.
    SELECT * INTO current_job FROM "artifact_preprocess_jobs" WHERE "id" = NEW."id";
    IF current_job."state" = 'claimed' AND (current_job."derived_artifact_id" IS NULL OR current_job."task_id" IS NULL OR current_job."task_name" IS NULL OR current_job."claim_expires_at" IS NULL OR current_job."claim_expires_at" <= clock_timestamp()) THEN
        RAISE EXCEPTION 'ArtifactPreprocessJob claimed delivery must commit live with its task and derived Artifact';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_artifact_preprocess_output_lease_finalization"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- Let the worker finalize its output lease only after saving completion evidence; the controller
    -- may then consume that evidence and finish the job without extending the worker's expired claim.
    IF NEW."state" = 'finalized' AND EXISTS (SELECT 1 FROM "artifact_preprocess_jobs" WHERE "output_lease_id" = NEW."id" AND NOT ("state" = 'completed' OR ("state" = 'claimed' AND "derived_revision_id" IS NOT NULL AND "completion_digest" IS NOT NULL))) THEN
        RAISE EXCEPTION 'ArtifactPreprocessJob output lease may finalize only with saved completion evidence';
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION "enforce_skill_authoring_validation"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision_silo_id TEXT; revision_state "SkillRevisionState"; revision_trust "SkillTrustClass";
        revision_artifact_revision_id TEXT; revision_address TEXT; artifact_revision_state "ArtifactRevisionState"; artifact_state "ArtifactState";
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SkillAuthoringValidation rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'pending' OR NEW."task_id" IS NOT NULL OR NEW."task_name" IS NOT NULL OR NEW."started_at" IS NOT NULL
            OR NEW."completed_at" IS NOT NULL OR NEW."failure_code" IS NOT NULL THEN
            RAISE EXCEPTION 'SkillAuthoringValidation must begin pending without task, running, or completion facts';
        END IF;
        SELECT skill."silo_id", revision."state", revision."trust_class", revision."artifact_revision_id", revision."artifact_content_address", artifact_revision."state", artifact."state"
          INTO revision_silo_id, revision_state, revision_trust, revision_artifact_revision_id, revision_address, artifact_revision_state, artifact_state
          FROM "skill_revisions" revision
          JOIN "skills" skill ON skill."id" = revision."skill_id"
          JOIN "artifact_revisions" artifact_revision ON artifact_revision."id" = revision."artifact_revision_id" AND artifact_revision."content_address" = revision."artifact_content_address"
          JOIN "artifacts" artifact ON artifact."id" = artifact_revision."artifact_id"
         WHERE revision."id" = NEW."skill_revision_id"
         FOR UPDATE OF revision, skill, artifact_revision, artifact;
        IF revision_silo_id IS DISTINCT FROM NEW."silo_id" OR revision_state IS DISTINCT FROM 'draft'
            OR revision_trust IS DISTINCT FROM 'sandboxed_python' OR revision_artifact_revision_id IS DISTINCT FROM NEW."artifact_revision_id"
            OR revision_address IS DISTINCT FROM NEW."artifact_content_address" OR artifact_revision_state IS DISTINCT FROM 'published'
            OR artifact_state IS DISTINCT FROM 'active' THEN
            RAISE EXCEPTION 'SkillAuthoringValidation requires same-silo Draft Python revision with its active pinned artifact';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."skill_revision_id" IS DISTINCT FROM OLD."skill_revision_id"
        OR NEW."artifact_revision_id" IS DISTINCT FROM OLD."artifact_revision_id" OR NEW."artifact_content_address" IS DISTINCT FROM OLD."artifact_content_address"
        OR NEW."task_key" IS DISTINCT FROM OLD."task_key") THEN
        RAISE EXCEPTION 'SkillAuthoringValidation immutable admission facts cannot change';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."task_id" IS NOT NULL AND (NEW."task_id" IS DISTINCT FROM OLD."task_id" OR NEW."task_name" IS DISTINCT FROM OLD."task_name") THEN
        RAISE EXCEPTION 'SkillAuthoringValidation task receipt is immutable';
    END IF;
    IF (NEW."task_id" IS NULL) <> (NEW."task_name" IS NULL) OR NEW."task_key" !~ '^workflows:skill-authoring-validation:[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'SkillAuthoringValidation requires paired task receipt and task key';
    END IF;
    IF NEW."task_name" IS NOT NULL AND NEW."task_name" <> 'skills.authoring.validate/v1' THEN
        RAISE EXCEPTION 'SkillAuthoringValidation task receipt must name the reviewed task';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'pending' AND NEW."state" NOT IN ('pending', 'running', 'cancelled') THEN
        RAISE EXCEPTION 'SkillAuthoringValidation has an invalid transition from pending';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'running' AND NEW."state" NOT IN ('running', 'succeeded', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'SkillAuthoringValidation has an invalid transition from running';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'pending' AND NEW."state" = 'pending' THEN
        IF NEW."started_at" IS NOT NULL OR NEW."completed_at" IS NOT NULL OR NEW."failure_code" IS NOT NULL THEN
            RAISE EXCEPTION 'pending SkillAuthoringValidation may only bind its task receipt';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'pending' AND NEW."state" = 'running' THEN
        IF OLD."task_id" IS NULL OR NEW."task_id" IS DISTINCT FROM OLD."task_id" OR NEW."task_name" IS DISTINCT FROM OLD."task_name"
            OR NEW."completed_at" IS NOT NULL OR NEW."failure_code" IS NOT NULL
            OR NOT EXISTS (
                SELECT 1 FROM "skill_authoring_validation_workload_claims" claim
                 WHERE claim."validation_id" = NEW."id" AND claim."workload_uid" IS NOT NULL
            ) THEN
            RAISE EXCEPTION 'SkillAuthoringValidation may run only after its saved task and bound workload claim';
        END IF;
        NEW."started_at" := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'running' AND NEW."state" = 'running' THEN
        IF NEW."task_id" IS DISTINCT FROM OLD."task_id" OR NEW."task_name" IS DISTINCT FROM OLD."task_name"
            OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
            OR NEW."completed_at" IS NOT NULL OR NEW."failure_code" IS NOT NULL THEN
            RAISE EXCEPTION 'running SkillAuthoringValidation preserves its task and start time';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'running' AND NEW."state" IN ('succeeded', 'failed') THEN
        IF NEW."started_at" IS DISTINCT FROM OLD."started_at" OR NOT EXISTS (
            SELECT 1 FROM "skill_authoring_validation_workload_claims" claim
             WHERE claim."validation_id" = NEW."id" AND claim."workload_uid" IS NOT NULL AND claim."first_pod_uid" IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'terminal SkillAuthoringValidation preserves its claimed worker identity';
        END IF;
        IF NEW."state" = 'succeeded' AND (NEW."failure_code" IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM "skill_authoring_validation_completion_inbox" inbox
             WHERE inbox."validation_id" = NEW."id" AND inbox."outcome" = 'succeeded'
        )) THEN
            RAISE EXCEPTION 'successful SkillAuthoringValidation requires its saved successful completion';
        END IF;
        IF NEW."state" = 'failed' AND (NEW."failure_code" IS NULL OR NOT EXISTS (
            SELECT 1 FROM "skill_authoring_validation_completion_inbox" inbox
             WHERE inbox."validation_id" = NEW."id" AND inbox."outcome" = 'failed' AND inbox."failure_code" = NEW."failure_code"
        )) THEN
            RAISE EXCEPTION 'failed SkillAuthoringValidation requires its saved failure completion';
        END IF;
        NEW."completed_at" := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" IN ('pending', 'running') AND NEW."state" = 'cancelled' THEN
        IF NEW."task_id" IS NULL OR NEW."failure_code" IS NOT NULL THEN
            RAISE EXCEPTION 'cancelled SkillAuthoringValidation preserves its admitted identity without failure evidence';
        END IF;
        NEW."completed_at" := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" IN ('succeeded', 'failed', 'cancelled') AND (NEW."state" IS DISTINCT FROM OLD."state" OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at" OR NEW."failure_code" IS DISTINCT FROM OLD."failure_code") THEN
        RAISE EXCEPTION 'terminal SkillAuthoringValidation state is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_skill_authoring_validation_workload_claim"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE validation_state "SkillAuthoringValidationState"; validation_task_id TEXT;
        transition_time TIMESTAMP(3) := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim rows cannot be deleted'; END IF;
    SELECT "state", "task_id" INTO validation_state, validation_task_id
      FROM "skill_authoring_validations" WHERE "id" = NEW."validation_id" FOR UPDATE;
    IF NOT FOUND OR NEW."workload_class" <> 'skill_authoring_validation' OR NEW."profile_name" <> 'authoring'
        OR NEW."idempotency_key" !~ '^workflows:skill-authoring-validation-workload:[a-f0-9]{64}$'
        OR btrim(NEW."execution_reference") = '' OR length(NEW."execution_reference") > 200 THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim requires its fixed authoring executor identity';
    END IF;
    IF (NEW."claimed_at" IS NULL) <> (NEW."expires_at" IS NULL) OR NEW."delivery_count" < 0 THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim requires paired lease facts and a non-negative delivery count';
    END IF;
    IF NEW."workload_uid" IS NOT NULL AND btrim(NEW."workload_uid") = '' THEN RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim workload identity cannot be blank'; END IF;
    IF NEW."first_pod_uid" IS NOT NULL AND (NEW."workload_uid" IS NULL OR btrim(NEW."first_pod_uid") = '') THEN RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim Pod identity requires its workload'; END IF;
    IF TG_OP = 'INSERT' THEN
        IF validation_state <> 'pending' OR validation_task_id IS NULL OR NEW."claimed_at" IS NOT NULL OR NEW."delivery_count" <> 0
            OR NEW."workload_uid" IS NOT NULL OR NEW."first_pod_uid" IS NOT NULL THEN
            RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim must begin unclaimed after task admission';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."validation_id" IS DISTINCT FROM OLD."validation_id" OR NEW."workload_class" IS DISTINCT FROM OLD."workload_class"
        OR NEW."profile_name" IS DISTINCT FROM OLD."profile_name" OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
        OR NEW."execution_reference" IS DISTINCT FROM OLD."execution_reference" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim identity is immutable';
    END IF;
    IF OLD."workload_uid" IS NOT NULL AND NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid" THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim workload identity is immutable';
    END IF;
    IF OLD."first_pod_uid" IS NOT NULL AND NEW."first_pod_uid" IS DISTINCT FROM OLD."first_pod_uid" THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim first Pod identity is immutable';
    END IF;
    IF NEW."claimed_at" IS NOT DISTINCT FROM OLD."claimed_at" AND NEW."expires_at" IS NOT DISTINCT FROM OLD."expires_at"
        AND NEW."delivery_count" = OLD."delivery_count" AND NEW."workload_uid" IS NOT DISTINCT FROM OLD."workload_uid"
        AND NEW."first_pod_uid" IS NOT DISTINCT FROM OLD."first_pod_uid"
        AND (OLD."claimed_at" IS NULL OR (OLD."first_pod_uid" IS NULL AND transition_time >= OLD."expires_at")) THEN
        IF OLD."workload_uid" IS NULL AND validation_state <> 'pending' THEN
            RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim initial lease requires a pending validation';
        END IF;
        IF OLD."workload_uid" IS NOT NULL AND validation_state <> 'running' THEN
            RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim renewed lease requires a running validation';
        END IF;
        NEW."claimed_at" := transition_time;
        NEW."expires_at" := transition_time + interval '5 minutes';
        NEW."delivery_count" := OLD."delivery_count" + 1;
        RETURN NEW;
    END IF;
    IF OLD."workload_uid" IS NULL AND NEW."workload_uid" IS NOT NULL THEN
        IF validation_state <> 'pending' OR validation_task_id IS NULL OR OLD."claimed_at" IS NULL OR OLD."expires_at" IS NULL
            OR transition_time >= OLD."expires_at" OR NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at"
            OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."delivery_count" <> OLD."delivery_count" THEN
            RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim workload binding requires its current pending lease';
        END IF;
    ELSIF OLD."first_pod_uid" IS NULL AND NEW."first_pod_uid" IS NOT NULL THEN
        IF validation_state <> 'running' OR OLD."workload_uid" IS NULL OR transition_time >= OLD."expires_at"
            OR NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
            OR NEW."delivery_count" <> OLD."delivery_count" THEN
            RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim Pod binding requires its current running lease';
        END IF;
    ELSIF NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
        OR NEW."delivery_count" IS DISTINCT FROM OLD."delivery_count" THEN
        IF NEW."first_pod_uid" IS NOT NULL OR NEW."claimed_at" IS NULL OR NEW."expires_at" IS NULL OR NEW."expires_at" <= NEW."claimed_at"
            OR NEW."delivery_count" <> OLD."delivery_count" + 1
            OR (OLD."expires_at" IS NOT NULL AND transition_time < OLD."expires_at")
            OR (OLD."claimed_at" IS NOT NULL AND NEW."claimed_at" <= OLD."claimed_at")
            OR (OLD."workload_uid" IS NULL AND validation_state <> 'pending')
            OR (OLD."workload_uid" IS NOT NULL AND validation_state <> 'running') THEN
            RAISE EXCEPTION 'SkillAuthoringValidationWorkloadClaim lease generation must advance after expiry';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_skill_authoring_validation_bootstrap"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE validation_pod_uid TEXT; validation_state "SkillAuthoringValidationState";
        transition_time TIMESTAMP(3) := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SkillAuthoringValidationBootstrap rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' AND (NEW."consumed_at" IS NOT NULL OR NEW."consumed_by_pod_uid" IS NOT NULL) THEN
        RAISE EXCEPTION 'SkillAuthoringValidationBootstrap must begin unconsumed';
    END IF;
    IF NEW."reference_hash" !~ '^sha256:[a-f0-9]{64}$'
        OR (NEW."consumed_at" IS NULL) <> (NEW."consumed_by_pod_uid" IS NULL)
        OR NEW."namespace" !~ '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$' OR length(NEW."namespace") > 63
        OR NEW."service_account" <> 'skill-authoring-default' THEN
        RAISE EXCEPTION 'SkillAuthoringValidationBootstrap has invalid one-use worker identity';
    END IF;
    SELECT claim."first_pod_uid", validation."state" INTO validation_pod_uid, validation_state
      FROM "skill_authoring_validations" validation
      JOIN "skill_authoring_validation_workload_claims" claim ON claim."validation_id" = validation."id"
     WHERE validation."id" = NEW."validation_id" FOR UPDATE OF validation, claim;
    IF validation_state IS DISTINCT FROM 'running' THEN
        RAISE EXCEPTION 'SkillAuthoringValidationBootstrap requires its running validation claim';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW."expires_at" := transition_time + interval '5 minutes';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."consumed_at" IS NULL AND validation_pod_uid IS NULL
        AND NEW."validation_id" IS NOT DISTINCT FROM OLD."validation_id" AND NEW."reference_hash" IS NOT DISTINCT FROM OLD."reference_hash"
        AND NEW."namespace" IS NOT DISTINCT FROM OLD."namespace" AND NEW."service_account" IS NOT DISTINCT FROM OLD."service_account"
        AND NEW."expires_at" IS NOT DISTINCT FROM OLD."expires_at" THEN
        IF transition_time >= OLD."expires_at" THEN
            NEW."expires_at" := transition_time + interval '5 minutes';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."validation_id" IS DISTINCT FROM OLD."validation_id" OR NEW."reference_hash" IS DISTINCT FROM OLD."reference_hash"
        OR NEW."namespace" IS DISTINCT FROM OLD."namespace"
        OR NEW."service_account" IS DISTINCT FROM OLD."service_account" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at") THEN
        RAISE EXCEPTION 'SkillAuthoringValidationBootstrap identity is immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD."consumed_at" IS NOT NULL OR NEW."consumed_at" IS NULL OR NEW."consumed_by_pod_uid" IS NULL
        OR validation_pod_uid IS DISTINCT FROM NEW."consumed_by_pod_uid" OR transition_time >= OLD."expires_at") THEN
        RAISE EXCEPTION 'SkillAuthoringValidationBootstrap may be consumed once by its registered Pod before expiry';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."consumed_at" IS NULL AND NEW."consumed_at" IS NOT NULL THEN
        NEW."consumed_at" := transition_time;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_skill_authoring_validation_completion"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE validation_state "SkillAuthoringValidationState"; validation_pod_uid TEXT;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'SkillAuthoringValidationCompletionInbox rows are immutable'; END IF;
    SELECT validation."state", claim."first_pod_uid" INTO validation_state, validation_pod_uid
      FROM "skill_authoring_validations" validation
      JOIN "skill_authoring_validation_workload_claims" claim ON claim."validation_id" = validation."id"
     WHERE validation."id" = NEW."validation_id" FOR UPDATE OF validation, claim;
    IF validation_state IS DISTINCT FROM 'running' OR validation_pod_uid IS NULL OR NEW."completion_digest" !~ '^sha256:[a-f0-9]{64}$'
        OR NOT EXISTS (
            SELECT 1 FROM "skill_authoring_validation_bootstraps" bootstrap
             WHERE bootstrap."validation_id" = NEW."validation_id" AND bootstrap."consumed_at" IS NOT NULL
               AND bootstrap."consumed_by_pod_uid" = validation_pod_uid
        ) THEN
        RAISE EXCEPTION 'SkillAuthoringValidationCompletionInbox requires a running validation and digest';
    END IF;
    IF NEW."outcome" = 'succeeded' AND (NEW."failure_code" IS NOT NULL OR jsonb_typeof(NEW."test_report") <> 'object' OR jsonb_typeof(NEW."scan_result") <> 'object') THEN
        RAISE EXCEPTION 'successful SkillAuthoringValidationCompletionInbox requires reports only';
    END IF;
    IF NEW."outcome" = 'failed' AND (NEW."test_report" IS NOT NULL OR NEW."scan_result" IS NOT NULL OR NEW."failure_code" !~ '^[a-z][a-z0-9_]{0,63}$') THEN
        RAISE EXCEPTION 'failed SkillAuthoringValidationCompletionInbox requires a bounded failure code only';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION "enforce_skill_authoring_validation_event_outbox"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inbox_validation_id TEXT; inbox_completion_digest TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SkillAuthoringValidationWorkflowEventOutbox rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' AND (NEW."event_name" <> 'skill-authoring-completed' OR NEW."published_at" IS NOT NULL OR NEW."publication_attempts" <> 0) THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkflowEventOutbox must begin as an unpublished completion event';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW."completion_inbox_id" IS DISTINCT FROM OLD."completion_inbox_id" OR NEW."event_name" IS DISTINCT FROM OLD."event_name" OR NEW."payload" IS DISTINCT FROM OLD."payload" OR NEW."publication_attempts" < OLD."publication_attempts") THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkflowEventOutbox immutable event facts cannot change';
    END IF;
    SELECT "validation_id", "completion_digest" INTO inbox_validation_id, inbox_completion_digest
      FROM "skill_authoring_validation_completion_inbox" WHERE "id" = NEW."completion_inbox_id" FOR KEY SHARE;
    IF jsonb_typeof(NEW."payload") <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW."payload")) <> 2
        OR NEW."payload"->>'validationId' IS DISTINCT FROM inbox_validation_id
        OR NEW."payload"->>'completionDigest' IS DISTINCT FROM inbox_completion_digest THEN
        RAISE EXCEPTION 'SkillAuthoringValidationWorkflowEventOutbox payload must name its saved completion';
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE "channel_invocation_contexts" ADD CONSTRAINT "channel_invocation_contexts_route_id_receiver_id_silo_id_a_fkey" FOREIGN KEY ("route_id", "receiver_id", "silo_id", "agent_service_id", "action") REFERENCES "channel_runtime_routes"("id", "receiver_id", "silo_id", "agent_service_id", "action") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_assets" ADD CONSTRAINT "conversation_assets_conversation_id_run_id_run_event_seque_fkey" FOREIGN KEY ("conversation_id", "run_id", "run_event_sequence") REFERENCES "conversation_run_events"("conversation_id", "run_id", "sequence") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_asset_output_tickets" ADD CONSTRAINT "conversation_asset_output_tickets_conversation_id_run_id_r_fkey" FOREIGN KEY ("conversation_id", "run_id", "run_event_sequence") REFERENCES "conversation_run_events"("conversation_id", "run_id", "sequence") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_onboardings" ADD CONSTRAINT "user_onboardings_bootstrap_content_revision_id_bootstrap_c_fkey" FOREIGN KEY ("bootstrap_content_revision_id", "bootstrap_content_digest") REFERENCES "user_onboarding_bootstrap_content_revisions"("id", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_onboarding_bootstrap_conversations" ADD CONSTRAINT "user_onboarding_bootstrap_conversations_content_revision_i_fkey" FOREIGN KEY ("content_revision_id", "content_digest") REFERENCES "user_onboarding_bootstrap_content_revisions"("id", "digest") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_era_probe_evidence_check" CHECK (
    ("era_probe_status" = 'not-required' AND "era_probe_attempts" = 0 AND "registration_key_digest" IS NULL AND "registration_digest" IS NULL AND "era_protocol_version" IS NULL AND "era_probe_evidence_digest" IS NULL AND "era_probe_failure_code" IS NULL AND "era_probed_at" IS NULL)
    OR ("era_probe_status" = 'pending' AND "era_probe_attempts" >= 0 AND "registration_key_digest" IS NOT NULL AND "registration_digest" IS NOT NULL AND "era_protocol_version" IS NULL AND "era_probe_evidence_digest" IS NULL AND "era_probe_failure_code" IS NULL AND "era_probed_at" IS NULL)
    OR ("era_probe_status" = 'accepted' AND "era_probe_attempts" >= 1 AND "registration_key_digest" IS NOT NULL AND "registration_digest" IS NOT NULL AND btrim("era_protocol_version") <> '' AND "era_probe_evidence_digest" ~ '^sha256:[0-9a-f]{64}$' AND "era_probe_failure_code" IS NULL AND "era_probed_at" IS NOT NULL)
    OR ("era_probe_status" = 'rejected' AND "era_probe_attempts" >= 1 AND "registration_key_digest" IS NOT NULL AND "registration_digest" IS NOT NULL AND "era_probe_evidence_digest" ~ '^sha256:[0-9a-f]{64}$' AND "era_probed_at" IS NOT NULL AND ((btrim("era_protocol_version") <> '' AND "era_probe_failure_code" = 'unsupported_mcp_protocol_version') OR ("era_protocol_version" IS NULL AND "era_probe_failure_code" IN ('unsafe_endpoint', 'not_mcp_server', 'retry_exhausted'))))
);
ALTER TABLE "oci_image_validation_claims" ADD CONSTRAINT "oci_image_validation_claims_identity_check" CHECK (
    btrim("silo_id") <> '' AND "identity_digest" ~ '^sha256:[0-9a-f]{64}$'
);
ALTER TABLE "oci_image_validations" ADD CONSTRAINT "oci_image_validations_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("artifact_id") <> '' AND btrim("artifact_revision_id") <> '' AND
    btrim("created_by_principal_id") <> '' AND btrim("media_type") <> '' AND "byte_length" >= 0 AND
    "content_address" ~ '^sha256:[0-9a-f]{64}$' AND
    "submission_key_digest" ~ '^sha256:[0-9a-f]{64}$' AND "submission_digest" ~ '^sha256:[0-9a-f]{64}$'
);
ALTER TABLE "oci_image_validations" ADD CONSTRAINT "oci_image_validations_result_check" CHECK (
    ("state" = 'pending' AND "index_digest" IS NULL AND "image_manifest_digest" IS NULL AND "config_digest" IS NULL AND "registry_reference" IS NULL AND "failure_code" IS NULL AND "completed_at" IS NULL)
    OR ("state" = 'imported' AND "index_digest" ~ '^sha256:[0-9a-f]{64}$' AND "image_manifest_digest" ~ '^sha256:[0-9a-f]{64}$' AND "config_digest" ~ '^sha256:[0-9a-f]{64}$' AND "registry_reference" ~ '^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$' AND "failure_code" IS NULL AND "completed_at" IS NOT NULL)
    OR ("state" = 'rejected' AND "index_digest" IS NULL AND "image_manifest_digest" IS NULL AND "config_digest" IS NULL AND "registry_reference" IS NULL AND "failure_code" IN ('artifact_mismatch', 'bundle_too_large', 'malformed_zip_package', 'not_oci_image_layout', 'invalid_layout', 'invalid_index', 'invalid_image_manifest', 'validation_failed', 'registry_import_failed') AND "completed_at" IS NOT NULL)
);
ALTER TABLE "run_input_snapshots" ADD CONSTRAINT "run_input_snapshots_run_input_check" CHECK (
    ("conversation_id" IS NULL OR btrim("conversation_id") <> '')
    AND btrim("capability_set_digest") <> ''
    AND "capability_set_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND jsonb_typeof("memory_facts") = 'array'
	AND jsonb_typeof("mcp_tools") = 'array'
);
ALTER TABLE "artifact_preprocess_jobs" ADD CONSTRAINT "artifact_preprocess_jobs_identity_check" CHECK (
        btrim("source_revision_id") <> '' AND btrim("pipeline_version") <> '' AND btrim("task_key") <> '' AND "delivery_count" >= 0
        AND ("task_id" IS NULL OR btrim("task_id") <> '') AND ("task_name" IS NULL OR btrim("task_name") <> '')
        AND ("profile_name" IS NULL OR btrim("profile_name") <> '') AND ("workload_uid" IS NULL OR btrim("workload_uid") <> '')
        AND ("first_pod_uid" IS NULL OR btrim("first_pod_uid") <> '') AND ("bootstrap_reference_hash" IS NULL OR "bootstrap_reference_hash" ~ '^sha256:[0-9a-f]{64}$')
        AND ("bootstrap_namespace" IS NULL OR btrim("bootstrap_namespace") <> '') AND ("completion_digest" IS NULL OR "completion_digest" ~ '^sha256:[0-9a-f]{64}$')
        AND ("claim_fence" IS NULL OR btrim("claim_fence") <> '')
        AND ("failure_code" IS NULL OR (btrim("failure_code") <> '' AND length("failure_code") <= 200))
    );

CREATE INDEX "artifact_preprocess_jobs_state_next_attempt_at_claim_expire_idx" ON "artifact_preprocess_jobs"("state", "next_attempt_at", "claim_expires_at");
CREATE UNIQUE INDEX "artifact_preprocess_jobs_source_revision_id_pipeline_versio_key" ON "artifact_preprocess_jobs"("source_revision_id", "pipeline_version");
CREATE UNIQUE INDEX "organization_invitations_silo_id_last_resend_idempotency_ke_key" ON "organization_invitations"("silo_id", "last_resend_idempotency_key");
CREATE UNIQUE INDEX "organization_invitation_requests_silo_id_actor_subject_idem_key" ON "organization_invitation_requests"("silo_id", "actor_subject", "idempotency_key");
CREATE UNIQUE INDEX "user_onboarding_bootstrap_content_revisions_archetype_revis_key" ON "user_onboarding_bootstrap_content_revisions"("archetype", "revision");
CREATE UNIQUE INDEX "user_onboarding_bootstrap_content_revisions_primary_colour__key" ON "user_onboarding_bootstrap_content_revisions"("primary_colour", "revision");
CREATE UNIQUE INDEX "user_onboarding_bootstrap_answers_conversation_id_question__key" ON "user_onboarding_bootstrap_answers"("conversation_id", "question_ordinal");
CREATE UNIQUE INDEX "user_onboarding_bootstrap_answers_conversation_id_idempoten_key" ON "user_onboarding_bootstrap_answers"("conversation_id", "idempotency_key");



CREATE TRIGGER "agent_revision_mcp_tool_assignments_immutable"
    BEFORE INSERT OR UPDATE OR DELETE ON "agent_revision_mcp_tool_assignments"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_assignment_immutability"();
CREATE TRIGGER "skill_authoring_validations_authority" BEFORE INSERT OR UPDATE OR DELETE ON "skill_authoring_validations" FOR EACH ROW EXECUTE FUNCTION "enforce_skill_authoring_validation"();
CREATE TRIGGER "skill_authoring_validation_workload_claims_authority" BEFORE INSERT OR UPDATE OR DELETE ON "skill_authoring_validation_workload_claims" FOR EACH ROW EXECUTE FUNCTION "enforce_skill_authoring_validation_workload_claim"();
CREATE TRIGGER "skill_authoring_validation_bootstraps_authority" BEFORE INSERT OR UPDATE OR DELETE ON "skill_authoring_validation_bootstraps" FOR EACH ROW EXECUTE FUNCTION "enforce_skill_authoring_validation_bootstrap"();
CREATE TRIGGER "skill_authoring_validation_completion_inbox_authority" BEFORE INSERT OR UPDATE OR DELETE ON "skill_authoring_validation_completion_inbox" FOR EACH ROW EXECUTE FUNCTION "enforce_skill_authoring_validation_completion"();
CREATE TRIGGER "skill_authoring_validation_event_outbox_authority" BEFORE INSERT OR UPDATE OR DELETE ON "skill_authoring_validation_workflow_event_outbox" FOR EACH ROW EXECUTE FUNCTION "enforce_skill_authoring_validation_event_outbox"();
CREATE CONSTRAINT TRIGGER "artifact_preprocess_claim_completeness" AFTER INSERT OR UPDATE ON "artifact_preprocess_jobs"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_preprocess_claim_completeness"();
CREATE TRIGGER "artifact_preprocess_jobs_closed_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "artifact_preprocess_jobs"
    FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_preprocess_job_lifecycle"();
CREATE TRIGGER "run_outbox_events_monotonic"
    BEFORE UPDATE OR DELETE ON "run_outbox_events"
    FOR EACH ROW EXECUTE FUNCTION "enforce_run_outbox_event_update"();

COMMIT;
