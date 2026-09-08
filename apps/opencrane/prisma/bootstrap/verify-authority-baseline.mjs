import { readFileSync } from "node:fs";

const _BASELINE = new URL("./target-baseline.sql", import.meta.url);
const _MINIMUM_FUNCTIONS = 79;
const _MINIMUM_TRIGGERS = 89;
const _MINIMUM_CONSTRAINTS = 227;
const _REQUIRED_AUTHORITY_MARKERS = [
	'CREATE TYPE "WorkloadKind" AS ENUM (\'pod\', \'job\', \'deployment\');',
	'ALTER TABLE "audit_decisions" ADD CONSTRAINT "audit_decisions_workload_identity_check"',
	'CREATE TABLE "oidc_sessions"',
	'CONSTRAINT "oidc_sessions_pkey" PRIMARY KEY ("namespace","id_digest")',
	'CREATE INDEX "oidc_sessions_namespace_retain_until_idx" ON "oidc_sessions"("namespace", "retain_until")',
	'CREATE FUNCTION "enforce_authorization_grant_update"()',
	'CREATE TABLE "provider_effect_commands"',
	'"desired_generation" INTEGER NOT NULL',
	'CREATE INDEX "provider_effect_commands_silo_id_resource_kind_resource_id__idx" ON "provider_effect_commands"("silo_id", "resource_kind", "resource_id", "desired_generation" DESC)',
	'CREATE INDEX "provider_effect_commands_follow_up_command_id_idx" ON "provider_effect_commands"("follow_up_command_id")',
	'CREATE UNIQUE INDEX "provider_effect_commands_silo_id_resource_kind_resource_id__key" ON "provider_effect_commands"("silo_id", "resource_kind", "resource_id", "desired_generation")',
	'CREATE UNIQUE INDEX "provider_credentials_global_provider_key" ON "provider_credentials"("silo_id", "provider") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL',
	'CREATE UNIQUE INDEX "model_definitions_global_public_model_name_key" ON "model_definitions"("silo_id", "public_model_name") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL',
	'CREATE UNIQUE INDEX "model_definitions_global_default_key" ON "model_definitions"("silo_id") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL AND "is_default"',
	'CREATE UNIQUE INDEX "model_definitions_silo_id_litellm_model_id_key" ON "model_definitions"("silo_id", "litellm_model_id")',
	'CREATE UNIQUE INDEX "model_routing_defaults_global_key" ON "model_routing_defaults"("silo_id") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL',
	'ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_model_definition_id_silo_id_fkey" FOREIGN KEY ("model_definition_id", "silo_id") REFERENCES "model_definitions"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE',
	'ALTER TABLE "model_definitions" ADD CONSTRAINT "model_definitions_provider_credential_id_silo_id_fkey" FOREIGN KEY ("provider_credential_id", "silo_id") REFERENCES "provider_credentials"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE',
	'CREATE UNIQUE INDEX "provider_effect_commands_silo_kind_resource_revision_key" ON "provider_effect_commands"("silo_id", "kind", "resource_id", "resource_revision")',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_identity_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_material_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_claim_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_completion_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_follow_up_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_follow_up_command_id_fkey" FOREIGN KEY ("follow_up_command_id") REFERENCES "provider_effect_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
	'"state" = \'claimed\' AND "completed_at" IS NULL AND "result" IS NOT NULL AND "failure_code" = \'provider_effect_finalization_blocked\'',
	'"failure_code" <> \'provider_effect_finalization_blocked\'',
	'"kind" = \'set_byok_key\' AND "state" = \'succeeded\' AND "follow_up_command_id" <> "id"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_payload_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_resource_binding_check"',
	'"material_verifier" IS NOT NULL AND "material_verifier" ~ \'^sha256:[0-9a-f]{64}$\'',
	'"desired_generation" > 0',
	'"payload" - ARRAY[\'provider\', \'secretRef\', \'litellmCredentialName\'] = \'{}\'::jsonb',
	'"payload" - ARRAY[\'modelDefinitionId\', \'publicModelName\', \'upstreamModel\', \'scope\', \'clusterTenant\', \'apiBase\', \'apiKeyEnvRef\', \'litellmCredentialName\', \'routingDefaultId\', \'selectedModelDefinitionId\'] = \'{}\'::jsonb',
	'jsonb_typeof("payload"->\'routingDefaultId\') = \'null\' AND jsonb_typeof("payload"->\'selectedModelDefinitionId\') = \'null\'',
	'"payload"->>\'selectedModelDefinitionId\' <> "payload"->>\'modelDefinitionId\'',
	'"payload"->>\'scope\' = \'global\'',
	'"payload"->>\'publicModelName\' = \'auto\'',
	'"resource_kind" = \'model-definition\'\n        AND "payload"->>\'modelDefinitionId\' = "resource_id"',
	'"resource_kind" = \'provider-connection\'\n        AND "resource_id" = \'byok:\' || "silo_id" || \':\' || ("payload"->>\'provider\')',
	'NEW."subject_kind" IS DISTINCT FROM OLD."subject_kind"',
	'NEW."boundary_coverage" IS DISTINCT FROM OLD."boundary_coverage"',
	'NEW."manager_id" IS DISTINCT FROM OLD."manager_id"',
	'CREATE TRIGGER "authorization_grants_immutable"',
	'CREATE TRIGGER "resource_shares_immutable"',
	'CREATE TRIGGER "resource_share_recipients_authority"',
	'ResourceShareRecipient must link its exact active manager-owned grant',
	'ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_exact_check"',
	"'capability-catalog-resource-sharing-v1',\n    'opencrane-resource-sharing',\n    1,\n    'sha256:8f77a4cad03cb7b536f6954df320d5ad3dfa726822ea32a0cf2848af4f45ca95'",
	'CREATE FUNCTION "enforce_agent_revision_assignment_immutability"()',
	'CREATE TRIGGER "agent_revision_mcp_tool_assignments_immutable"',
	'CREATE CONSTRAINT TRIGGER agent_runs_input_snapshot_complete',
	'CREATE VIEW "artifact_authority_clock" AS\n    SELECT 1::INTEGER AS "singleton", date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3) AS "now";',
	'CREATE VIEW "skill_authority_clock" AS\n    SELECT 1::INTEGER AS "singleton", date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3) AS "now";',
	'CREATE VIEW "mcp_runtime_clock" AS\n    SELECT 1::INTEGER AS "singleton", date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3) AS "now";',
	'CREATE FUNCTION "select_mcp_runtime_claim_candidate"()',
	'FOR UPDATE OF execution SKIP LOCKED',
	'CREATE VIEW "mcp_runtime_claim_candidates" AS SELECT * FROM "select_mcp_runtime_claim_candidate"();',
	'CREATE FUNCTION "select_mcp_runtime_release_claim_candidate"()',
	'CREATE VIEW "mcp_runtime_release_claim_candidates" AS SELECT * FROM "select_mcp_runtime_release_claim_candidate"();',
	'CREATE FUNCTION "enforce_mcp_runtime_execution_authority"()',
	'McpRuntimeExecution controller claim requires an expired prior fence and a bounded lease proposal',
	'McpRuntimeExecution companion fence is immutable outside claim or expired discovery reset',
	'CREATE TRIGGER "mcp_runtime_executions_authority"',
	'CREATE FUNCTION "enforce_mcp_server_revision_runtime_completion"()',
	'CREATE TRIGGER "mcp_server_revisions_runtime_completion"',
	'INSERT INTO "persona_question_sets" ("question_set_id", "version") VALUES (\'personal-agent-onboarding\', 1);',
	'(OLD."state" = \'survey_pending\' AND NEW."state" = \'survey_in_progress\')',
	'OLD."state" = \'survey_in_progress\' AND NEW."state" = \'survey_in_progress\'',
	'UserOnboarding interview provenance is immutable outside the initial survey',
	'"completion_provenance" IS NOT DISTINCT FROM \'bootstrap_concluded\'',
	'"bootstrap_content_digest" IS NOT NULL AND "bootstrap_content_digest" ~ \'^sha256:[0-9a-f]{64}$\'',
	'"completion_provenance" IS NOT DISTINCT FROM \'existing_user_migration\'',
	'"completion_migration_revision" IS NOT NULL AND btrim("completion_migration_revision") <> \'\'',
	'"completion_migration_batch" IS NOT NULL AND btrim("completion_migration_batch") <> \'\'',
	'CREATE TYPE "ConversationMode" AS ENUM (\'agent_session\', \'direct\', \'group\');',
	'CREATE INDEX "conversations_silo_id_mode_lifecycle_updated_at_idx" ON "conversations"("silo_id", "mode", "lifecycle", "updated_at")',
	'Conversation updated_at moves only with a participant-visible append or a lifecycle change',
	'AND xmin = pg_current_xact_id()::xid',
	'The expiry sweep runs after the computer lease may have lapsed, so pending -> expired skips the run and lease fence.',
	'ApprovalRequest expiry records no decider and no final arguments',
	'jsonb_typeof("mcp_tools") = \'array\'',
	'CREATE UNIQUE INDEX "agent_runs_one_foreground_per_conversation"',
	'CREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"(\n  "silo_id", "subject_kind", COALESCE("subject_group_id", \'\'), COALESCE("subject_principal_id", \'\'),\n  "boundary_kind", COALESCE("boundary_group_id", \'\'), COALESCE("boundary_principal_id", \'\'), "boundary_coverage",\n  "catalog_id", "catalog_revision", "capability_id", "resource_kind", COALESCE("resource_id", \'\'), "effect", "priority", COALESCE("manager_id", \'\')\n) WHERE "revoked_at" IS NULL',
	'CONSTRAINT "model_definitions_generated_output_capabilities_check"',
	'CREATE TYPE "ToolInvocationState" AS ENUM (\'preparing\', \'awaiting_approval\', \'ready\', \'claimed\', \'reconciling\', \'succeeded\', \'failed\', \'recovery_required\');',
	'CREATE TABLE "tool_result_deliveries"',
	'CREATE FUNCTION "enforce_tool_result_delivery_identity"()',
	'CREATE TRIGGER "tool_result_deliveries_invocation_identity" BEFORE INSERT OR UPDATE OF "tool_invocation_id", "payload" ON "tool_result_deliveries"',
	'CREATE FUNCTION "enforce_tool_invocation_lifecycle"()',
	'CREATE TRIGGER "tool_invocations_lifecycle_guard"',
	'CREATE FUNCTION "enforce_tool_invocation_authorization_evidence"()',
	'NEW."authorization_actor_kind" IS DISTINCT FROM \'workload\'::"ToolInvocationAuthorizationActorKind"',
	'NEW."authorization_execution_subject"->\'membership\'->>\'principalId\' IS DISTINCT FROM NEW."principal_id"',
	'task-owned ToolInvocation requires complete central authorization evidence without AgentRun fields',
	'CREATE TRIGGER "tool_invocations_authorization_evidence"',
	'ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_identity_check"',
	'ALTER TABLE "tool_result_deliveries" ADD CONSTRAINT "tool_result_deliveries_exact_check"',
	'CREATE TYPE "PersonalMemoryPermissionReceiptState" AS ENUM (\'active\', \'consumed\');',
	'CREATE UNIQUE INDEX "memory_datasets_exact_boundary_key"',
	'NEW."boundary_kind" IS DISTINCT FROM OLD."boundary_kind" OR NEW."boundary_group_id" IS DISTINCT FROM OLD."boundary_group_id" OR NEW."boundary_principal_id" IS DISTINCT FROM OLD."boundary_principal_id"',
	'CREATE FUNCTION "enforce_personal_memory_permission_authority"()',
	'WHERE "run_id" = NEW."run_id"\n      AND "attempt" = NEW."attempt"\n      AND "input_digest" = NEW."input_snapshot_digest"',
	'CREATE TRIGGER "personal_memory_permission_receipts_authority"',
	'ALTER TABLE "personal_memory_permission_receipts" ADD CONSTRAINT "personal_memory_permission_receipts_exact_check"',
	'"tool_invocation_revision" INTEGER NOT NULL',
	'"input_snapshot_digest" TEXT NOT NULL',
	'"persona_revision_id" TEXT NOT NULL',
	'ALTER TABLE "conversations" ADD CONSTRAINT "conversations_identity_check"',
	'CREATE UNIQUE INDEX "conversations_silo_id_computer_id_key" ON "conversations"("silo_id", "computer_id")',
	'"computer_agent_identity_id" IS NOT NULL AND btrim("computer_agent_identity_id") <> \'\'',
	'ALTER TABLE "conversation_private_payloads" ADD CONSTRAINT "conversation_private_payloads_encryption_check"',
	'CREATE TRIGGER "conversation_private_payloads_immutable"',
	'CREATE TRIGGER "conversation_child_requests_immutable_command"',
	'CREATE FUNCTION "enforce_conversation_child_request"()',
	'ConversationChildRequest command and audience are immutable',
];
const _FORBIDDEN_AUTHORITY_MARKERS = [
	'CREATE UNIQUE INDEX "model_definitions_litellm_model_id_key" ON "model_definitions"("litellm_model_id")',
	'CREATE UNIQUE INDEX "provider_effect_commands_kind_resource_id_resource_revision_key" ON "provider_effect_commands"("kind", "resource_id", "resource_revision")',
	'NEW."scope_kind" IS DISTINCT FROM OLD."scope_kind"',
	'CREATE UNIQUE INDEX "memory_datasets_exact_scope_key"',
	'btrim("organization_id") <> \'\' AND\n        (("scope_kind" = \'organization\'',
	'NEW."state" IN (\'survey_in_progress\', \'completed\')',
	'command.forward',
	'conversation_threads',
	'"thread_id"',
	'"source_thread_id"',
	'conversation_messages',
	'conversation_run_events',
	'conversation_timeline_entries',
	'ConversationTimelineEntryKind',
	'conversation_context_revisions',
	'channel_runtime_routes',
	'channel_invocation_contexts',
	'ChannelInvocationAction',
	'"resourceKind":"channel-target"',
	'ConversationContextRevision',
	'"context_revision_id"',
	'"activity_sequence"',
	'"proof_key_id"',
	'"proof_key_thumbprint"',
	'enforce_terminal_agent_run_event',
	'ConversationThread',
	'"allowed_tools"',
	'has_nonempty_distinct_tool_ids',
	'runtime_external_action_retries',
	'run.attempt_requested',
	'run.workload_release_requested',
	"'capability-catalog-opencrane-core-v1'",
	"'opencrane-core'",
];

/** Counts statements which begin at a SQL line boundary. */
function _CountStatements(baseline, pattern)
{
	return (baseline.match(pattern) ?? []).length;
}

/** Rejects duplicate names introduced when generated Prisma SQL and reviewed authority SQL are combined. */
function _VerifyUniqueNames(baseline, pattern, kind)
{
	const names = [...baseline.matchAll(pattern)].map(function _Name(match) { return match[1]; });
	const duplicates = [...new Set(names.filter(function _Duplicate(name, index) { return names.indexOf(name) !== index; }))];
	if (duplicates.length > 0)
	{
		throw new Error(`target baseline repeats ${kind}: ${duplicates.join(", ")}`);
	}
}

/** Rejects a Prisma-only baseline that has silently discarded the reviewed authority SQL layer. */
function _Verify()
{
	const baseline = readFileSync(_BASELINE, "utf8");
	const functions = _CountStatements(baseline, /^CREATE FUNCTION /gmu);
	const triggers = _CountStatements(baseline, /^CREATE (?:CONSTRAINT )?TRIGGER /gmu);
	const constraints = _CountStatements(baseline, /^ALTER TABLE .* ADD CONSTRAINT /gmu);
	_VerifyUniqueNames(baseline, /ADD CONSTRAINT "([^"]+)"/gmu, "constraints");
	_VerifyUniqueNames(baseline, /CREATE TYPE "([^"]+)"/gmu, "types");
	_VerifyUniqueNames(baseline, /CREATE TABLE "([^"]+)"/gmu, "tables");
	_VerifyUniqueNames(baseline, /CREATE (?:UNIQUE )?INDEX "([^"]+)"/gmu, "indexes");
	_VerifyUniqueNames(baseline, /CREATE FUNCTION "([^"]+)"/gmu, "functions");
	_VerifyUniqueNames(baseline, /CREATE (?:CONSTRAINT )?TRIGGER "?([A-Za-z0-9_]+)"?/gmu, "triggers");
	if (functions < _MINIMUM_FUNCTIONS || triggers < _MINIMUM_TRIGGERS || constraints < _MINIMUM_CONSTRAINTS)
	{
		throw new Error(`target baseline lost reviewed authority SQL: expected at least ${_MINIMUM_FUNCTIONS} functions, ${_MINIMUM_TRIGGERS} triggers, and ${_MINIMUM_CONSTRAINTS} constraints; found ${functions} functions, ${triggers} triggers, and ${constraints} constraints`);
	}
	for (const marker of _REQUIRED_AUTHORITY_MARKERS)
	{
		if (!baseline.includes(marker)) throw new Error(`target baseline lost required authority marker: ${marker}`);
	}
	for (const marker of _FORBIDDEN_AUTHORITY_MARKERS)
	{
		if (baseline.includes(marker)) throw new Error(`target baseline retained forbidden authority marker: ${marker}`);
	}
}

_Verify();
