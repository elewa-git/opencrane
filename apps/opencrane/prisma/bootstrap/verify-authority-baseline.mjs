import { readFileSync } from "node:fs";

const _BASELINE = new URL("./target-baseline.sql", import.meta.url);
const _MINIMUM_FUNCTIONS = 90;
const _MINIMUM_TRIGGERS = 101;
const _MINIMUM_CONSTRAINTS = 235;
const _REQUIRED_AUTHORITY_MARKERS = [
	'CREATE FUNCTION "enforce_authorization_grant_update"()',
	'CREATE TRIGGER "authorization_grants_immutable"',
	'ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_exact_check"',
	'CREATE FUNCTION "enforce_agent_revision_assignment_immutability"()',
	'CREATE CONSTRAINT TRIGGER agent_runs_input_snapshot_complete',
	'CREATE VIEW "artifact_authority_clock" AS\n    SELECT 1::INTEGER AS "singleton", date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3) AS "now";',
	'CREATE VIEW "skill_authority_clock" AS\n    SELECT 1::INTEGER AS "singleton", date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3) AS "now";',
	'bootstrap_expires_at TIMESTAMP(3); requested_lease INTERVAL;\n        transition_time TIMESTAMP(3) := date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3);',
	'DECLARE workload_kind "SkillWorkloadKind"; workload_state "SkillWorkloadState"; assigned_uid TEXT; assigned_pod_uid TEXT;\n        transition_time TIMESTAMP(3) := date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3);',
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
	'CREATE UNIQUE INDEX "conversations_activity_sequence_key"',
	'CREATE UNIQUE INDEX "agent_runs_one_foreground_per_conversation"',
	'CREATE FUNCTION "has_reviewed_tool_definitions"(JSONB)',
	'"tool_definitions" JSONB NOT NULL',
	'CREATE TYPE "ToolInvocationState" AS ENUM (\'preparing\', \'awaiting_approval\', \'ready\', \'claimed\', \'reconciling\', \'succeeded\', \'failed\', \'recovery_required\');',
	'CREATE TABLE "tool_result_deliveries"',
	'CREATE FUNCTION "enforce_tool_result_delivery_identity"()',
	'CREATE TRIGGER "tool_result_deliveries_invocation_identity" BEFORE INSERT OR UPDATE OF "tool_invocation_id", "payload" ON "tool_result_deliveries"',
	'CREATE FUNCTION "enforce_tool_invocation_lifecycle"()',
	'CREATE TRIGGER "tool_invocations_lifecycle_guard"',
	'ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_identity_check"',
	'ALTER TABLE "tool_result_deliveries" ADD CONSTRAINT "tool_result_deliveries_exact_check"',
	'CREATE TYPE "PersonalMemoryPermissionReceiptState" AS ENUM (\'active\', \'consumed\');',
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
	'ALTER TABLE "conversation_asset_output_tickets" ADD CONSTRAINT "conversation_asset_output_tickets_conversation_id_run_id_run_event_sequence_fkey"',
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
	'NEW."state" IN (\'survey_in_progress\', \'completed\')',
	'command.forward',
	'conversation_threads',
	'"thread_id"',
	'"source_thread_id"',
	'ConversationThread',
	'"allowed_tools"',
	'has_nonempty_distinct_tool_ids',
	'runtime_external_action_retries',
];

/** Counts statements which begin at a SQL line boundary. */
function _CountStatements(baseline, pattern)
{
	return (baseline.match(pattern) ?? []).length;
}

/** Rejects a Prisma-only baseline that has silently discarded the reviewed authority SQL layer. */
function _Verify()
{
	const baseline = readFileSync(_BASELINE, "utf8");
	const functions = _CountStatements(baseline, /^CREATE FUNCTION /gmu);
	const triggers = _CountStatements(baseline, /^CREATE (?:CONSTRAINT )?TRIGGER /gmu);
	const constraints = _CountStatements(baseline, /^ALTER TABLE .* ADD CONSTRAINT /gmu);
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
