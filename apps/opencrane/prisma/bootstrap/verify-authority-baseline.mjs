import { readFileSync } from "node:fs";

const _BASELINE = new URL("./target-baseline.sql", import.meta.url);
const _MINIMUM_FUNCTIONS = 90;
const _MINIMUM_TRIGGERS = 101;
const _MINIMUM_CONSTRAINTS = 235;
const _REQUIRED_AUTHORITY_MARKERS = [
	'CREATE FUNCTION "enforce_authorization_grant_update"()',
	'CREATE TABLE "provider_effect_commands"',
	'CREATE UNIQUE INDEX "provider_effect_commands_kind_resource_id_resource_revision_key"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_identity_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_material_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_claim_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_completion_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_payload_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_resource_binding_check"',
	'"material_verifier" IS NOT NULL AND "material_verifier" ~ \'^sha256:[0-9a-f]{64}$\'',
	'"payload" - ARRAY[\'provider\', \'secretRef\', \'litellmCredentialName\'] = \'{}\'::jsonb',
	'"resource_kind" = \'model-definition\'\n        AND "payload"->>\'modelDefinitionId\' = "resource_id"',
	'"resource_kind" = \'provider-connection\'\n        AND "resource_id" = \'byok:\' || ("payload"->>\'provider\')',
	'NEW."subject_kind" IS DISTINCT FROM OLD."subject_kind"',
	'NEW."boundary_coverage" IS DISTINCT FROM OLD."boundary_coverage"',
	'NEW."manager_id" IS DISTINCT FROM OLD."manager_id"',
	'CREATE TRIGGER "authorization_grants_immutable"',
	'CREATE TRIGGER "resource_shares_immutable"',
	'CREATE TRIGGER "resource_share_recipients_authority"',
	'ResourceShareRecipient must link its exact active manager-owned grant',
	'ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_exact_check"',
	"'capability-catalog-resource-sharing-v1',\n    'opencrane-resource-sharing',\n    1,\n    'sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775'",
	"'capability-catalog-opencrane-core-v1',\n    'opencrane-core',\n    1,\n    'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6'",
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
	'CREATE TYPE "ChannelInvocationAction" AS ENUM (\'events.read\');',
	'"legacy_expires_at" TIMESTAMP(3)',
	'CREATE UNIQUE INDEX "channel_runtime_routes_exact_target_key" ON "channel_runtime_routes"("id", "receiver_id", "silo_id", "agent_service_id", "action")',
	'CREATE FUNCTION "enforce_channel_runtime_route_evidence"()',
	'CREATE TRIGGER "channel_runtime_routes_evidence_guard"',
	'legacy ChannelRuntimeRoute evidence can only be created by a reviewed migration',
	'CREATE FUNCTION "enforce_conversation_timeline_entry"()',
	'CREATE TRIGGER "conversation_timeline_entries_allocate"',
	'"activity_sequence" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL',
	'"activity_sequence" = DEFAULT',
	'jsonb_typeof("mcp_tools") = \'array\'',
	'CREATE UNIQUE INDEX "conversations_activity_sequence_key"',
	'CREATE UNIQUE INDEX "agent_runs_one_foreground_per_conversation"',
	'CREATE UNIQUE INDEX "authorization_grant_exact_authority_key"',
	'CONSTRAINT "model_definitions_generated_output_capabilities_check"',
	'CREATE TYPE "ToolInvocationState" AS ENUM (\'preparing\', \'awaiting_approval\', \'ready\', \'claimed\', \'reconciling\', \'succeeded\', \'failed\', \'recovery_required\');',
	'CREATE TABLE "tool_result_deliveries"',
	'CREATE FUNCTION "enforce_tool_result_delivery_identity"()',
	'CREATE TRIGGER "tool_result_deliveries_invocation_identity" BEFORE INSERT OR UPDATE OF "tool_invocation_id", "payload" ON "tool_result_deliveries"',
	'CREATE FUNCTION "enforce_tool_invocation_lifecycle"()',
	'CREATE TRIGGER "tool_invocations_lifecycle_guard"',
	'CREATE FUNCTION "enforce_tool_invocation_authorization_evidence"()',
	'NEW."authorization_actor_kind" IS DISTINCT FROM \'user\'::"ToolInvocationAuthorizationActorKind"',
	'NEW."authorization_membership_revision" IS NOT NULL',
	'task-owned ToolInvocation requires complete central authorization evidence without AgentRun fields',
	'CREATE TRIGGER "tool_invocations_authorization_evidence"',
	'ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_identity_check"',
	'ALTER TABLE "tool_result_deliveries" ADD CONSTRAINT "tool_result_deliveries_exact_check"',
	'CREATE TYPE "PersonalMemoryPermissionReceiptState" AS ENUM (\'active\', \'consumed\');',
	'CREATE UNIQUE INDEX "memory_datasets_exact_boundary_key"',
	'NEW."boundary_kind" IS DISTINCT FROM OLD."boundary_kind" OR NEW."boundary_group_id" IS DISTINCT FROM OLD."boundary_group_id" OR NEW."boundary_principal_id" IS DISTINCT FROM OLD."boundary_principal_id"',
	'CREATE FUNCTION "enforce_personal_memory_permission_authority"()',
	'CREATE TRIGGER "personal_memory_permission_receipts_authority"',
	'ALTER TABLE "personal_memory_permission_receipts" ADD CONSTRAINT "personal_memory_permission_receipts_exact_check"',
	'"tool_invocation_revision" INTEGER NOT NULL',
	'"input_snapshot_digest" TEXT NOT NULL',
	'"persona_revision_id" TEXT NOT NULL',
	"'tool.failed'",
	"'run.error'",
	"'a2ui.rendering.begun', 'a2ui.surface.updated', 'a2ui.data_model.updated'",
	'ALTER TABLE "conversations" ADD CONSTRAINT "conversations_identity_check"',
	'ALTER TABLE "conversation_timeline_entries" ADD CONSTRAINT "conversation_timeline_entries_reference_shape_check"',
	'ALTER TABLE "conversation_asset_output_tickets" ADD CONSTRAINT "conversation_asset_output_tickets_run_id_run_attempt_fkey"',
	'ALTER TABLE "conversation_asset_output_tickets" ADD CONSTRAINT "conversation_asset_output_tickets_conversation_id_run_id_r_fkey" FOREIGN KEY ("conversation_id", "run_id", "run_event_sequence") REFERENCES "conversation_run_events"("conversation_id", "run_id", "sequence")',
	'CREATE UNIQUE INDEX "conversation_run_events_one_message_start"',
	'ALTER TABLE "conversation_assets" ADD CONSTRAINT "conversation_assets_exact_output_ticket_fkey"',
	'CREATE FUNCTION "enforce_conversation_asset_output_ticket_lifecycle"()',
	'CREATE TRIGGER "conversation_asset_output_tickets_lifecycle_guard"',
	'ConversationAssetOutputTicket identity is immutable',
	'ConversationAssetOutputTicket finalization lacks exact receipt evidence',
	'"finalized_content_address" IS NULL AND "finalized_receipt_digest" IS NULL AND "finalized_at" IS NULL',
	'event."payload"->>\'messageId\' = NEW."source_message_id"',
	'"provenance" = \'agent_output\' AND "created_by_user_id" IS NULL AND "message_id" IS NULL',
];
const _FORBIDDEN_AUTHORITY_MARKERS = [
	'NEW."scope_kind" IS DISTINCT FROM OLD."scope_kind"',
	'CREATE UNIQUE INDEX "memory_datasets_exact_scope_key"',
	'btrim("organization_id") <> \'\' AND\n        (("scope_kind" = \'organization\'',
	'NEW."state" IN (\'survey_in_progress\', \'completed\')',
	'command.forward',
	'conversation_threads',
	'"thread_id"',
	'"source_thread_id"',
	'ConversationThread',
	'"allowed_tools"',
	'has_nonempty_distinct_tool_ids',
	'runtime_external_action_retries',
	'run.attempt_requested',
	'run.workload_release_requested',
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
