import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSchemaDump } from "./normalize-schema-dump.mjs";

const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const transitionRoot = join(migrationRoot, "0.7.0-to-0.8.0");
const sql = readFileSync(join(transitionRoot, "migration.sql"), "utf8");
const manifest = JSON.parse(readFileSync(join(transitionRoot, "manifest.json"), "utf8"));
const targetBaseline = readFileSync(join(migrationRoot, "../bootstrap/target-baseline.sql"), "utf8");
const authorizationSchema = readFileSync(join(migrationRoot, "../schema/authorization.prisma"), "utf8");
const elicitationSchema = readFileSync(join(migrationRoot, "../schema/elicitation.prisma"), "utf8");
const conversationSchema = readFileSync(join(migrationRoot, "../schema/conversations.prisma"), "utf8");
const runtimeSchema = readFileSync(join(migrationRoot, "../schema/runtime.prisma"), "utf8");
const digest = createHash("sha256").update(sql).digest("hex");
const targetDigest = createHash("sha256").update(targetBaseline).digest("hex");
const organizationTransitionRoot = join(migrationRoot, "0.8.0-to-0.9.0");
const organizationSql = readFileSync(join(organizationTransitionRoot, "migration.sql"), "utf8");
const organizationManifest = JSON.parse(readFileSync(join(organizationTransitionRoot, "manifest.json"), "utf8"));
const organizationSqlDigest = createHash("sha256").update(organizationSql).digest("hex");

function requireContract(condition, message)
{
	if (!condition) throw new Error(message);
}

const reorderedTable = String.raw`CREATE TABLE public.example (
    "second" text NOT NULL,
    "first" text DEFAULT $value$a,b$value$ NOT NULL,
    "regular_backslash" text DEFAULT '\'::text,
    "escaped_quote" text DEFAULT E'one\'two,three'::text,
    CONSTRAINT example_check CHECK (("second" <> ','::text))
);
`;
const canonicalTable = String.raw`CREATE TABLE public.example (
    CONSTRAINT example_check CHECK (("second" <> ','::text)),
    "escaped_quote" text DEFAULT E'one\'two,three'::text,
    "first" text DEFAULT $value$a,b$value$ NOT NULL,
    "regular_backslash" text DEFAULT '\'::text,
    "second" text NOT NULL
);
`;
assert.equal(normalizeSchemaDump(reorderedTable), normalizeSchemaDump(canonicalTable));
assert.notEqual(
	normalizeSchemaDump(reorderedTable),
	normalizeSchemaDump(canonicalTable.replace("DEFAULT $value$a,b$value$", "DEFAULT $value$a,c$value$")),
);

requireContract(manifest.fromSchemaVersion === "0.7.0", "migration source version must remain exact");
requireContract(manifest.toSchemaVersion === "0.8.0", "migration target version must remain exact");
requireContract(manifest.sqlSha256 === digest, "migration SQL digest must match its manifest");
requireContract(manifest.targetBaselineSha256 === "7ed3f49ec3b96276cfce1c1d41e97588b0970fb28352c7d933269ce201ce32fc", "0.7.0 migration target must remain the immutable 0.8.0 baseline");
requireContract(
	manifest.sourceProtectedBaselineSha256 === "25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d",
	"migration must bind the default-owner protected source baseline",
);
requireContract(
	manifest.executionMode === "automatic-when-legacy-persona-conversations-channel-invocation-contexts-approval-requests-and-integration-assignments-empty-otherwise-manual-data-mapping-required",
	"migration execution mode must retain its conditional data boundary",
);
requireContract(sql.includes("pg_advisory_xact_lock"), "migration must acquire the database migration lock");
requireContract(sql.includes("opencrane_bootstrap\".\"target_baseline"), "migration must verify protected bootstrap provenance");
requireContract(sql.includes(manifest.sourceProtectedBaselineSha256), "SQL must require the manifest-bound protected source digest");
requireContract(sql.includes("opencrane_migrations.schema_history"), "migration must reject ambiguous pre-existing schema history");
requireContract(sql.includes("LOCK TABLE"), "migration must lock persona mutation sources before counting them");
requireContract(sql.includes("ERRCODE = 'OC708'"), "migration must retain the explicit semantic-mapping blocker");
requireContract(sql.includes("IF persona_profiles_count + persona_interviews_count"), "OC708 must be conditional on legacy runtime data");
requireContract(sql.includes("ERRCODE = 'OC710'"), "migration must retain the explicit Conversation semantic-mapping blocker");
requireContract(sql.includes("IF legacy_conversations_count + conversation_participants_count"), "OC710 must be conditional on legacy Conversation data");
requireContract(sql.includes('SELECT count(*) INTO legacy_invocation_contexts_count FROM "channel_invocation_contexts"'), "migration must explicitly count every legacy invocation context before replacing the table");
requireContract(sql.includes("+ active_conversation_runs_count + legacy_invocation_contexts_count"), "OC710 must reject every legacy invocation context before destructive replacement");
requireContract(sql.includes("ERRCODE = 'OC711'"), "migration must reject populated approval_requests");
requireContract(sql.includes("ERRCODE = 'OC712'"), "migration must reject legacy integration assignments without reviewed schemas");
requireContract(sql.includes('ADD COLUMN "tool_definitions" JSONB NOT NULL'), "migration must replace tool-name arrays with reviewed definitions");
requireContract(!targetBaseline.includes('"allowed_tools"'), "target baseline must not retain tool-name-only authority");
requireContract(authorizationSchema.includes("model ToolResultDelivery"), "authorization schema must own exact tool-result delivery");
requireContract(!runtimeSchema.includes("model RuntimeExternalActionRetry"), "runtime schema must retire the split retry budget");
requireContract(elicitationSchema.includes("toolInvocationRevision Int"), "memory permission must bind the exact invocation revision");
requireContract(elicitationSchema.includes("inputSnapshotDigest    String"), "memory permission must bind the frozen input snapshot digest");
requireContract(elicitationSchema.includes("personaRevisionId      String"), "memory permission must bind the frozen persona revision");
for (const source of [targetBaseline, sql])
{
	requireContract(source.includes('CREATE FUNCTION "enforce_personal_memory_permission_authority"()'), "memory permission must retain its relational authority trigger");
	requireContract(source.includes('CREATE TRIGGER "personal_memory_permission_receipts_authority"'), "memory permission trigger must protect inserts and consumption");
	requireContract(source.includes('"tool_invocation_id" TEXT NOT NULL'), "memory permission must retain its exact ToolInvocation foreign key");
	requireContract(source.includes('"tool_invocation_revision" INTEGER NOT NULL'), "memory permission must retain its exact invocation revision");
	requireContract(source.includes('"input_snapshot_digest" TEXT NOT NULL'), "memory permission must retain the frozen input snapshot digest");
	requireContract(source.includes('"persona_revision_id" TEXT NOT NULL'), "memory permission must retain the frozen persona revision");
	requireContract(!source.includes('"subject_id" TEXT NOT NULL, "execution_subject_id" TEXT NOT NULL, "purpose_digest"'), "memory permission must not retain the ambiguous participant field");
}
for (const source of [targetBaseline, sql])
{
	requireContract(source.includes('CREATE TYPE "ToolInvocationState"'), "tool invocation lifecycle must use its own durable state vocabulary");
	requireContract(source.includes('CREATE TYPE "ExternalActionRecoveryMode"'), "tool invocation recovery strategy must be frozen before dispatch");
	requireContract(source.includes('CREATE TABLE "tool_result_deliveries"'), "terminal tool results must use one durable delivery outbox");
	requireContract(source.includes('CREATE FUNCTION "enforce_tool_result_delivery_identity"'), "tool result delivery identity must use relational invocation authority");
	requireContract(source.includes('CREATE TRIGGER "tool_result_deliveries_invocation_identity" BEFORE INSERT OR UPDATE OF "tool_invocation_id", "payload" ON "tool_result_deliveries"'), "tool result delivery identity must remain enforced on inserts and identity updates");
	requireContract(!source.includes('"payload"->>\'toolInvocationId\' = "tool_invocation_id"'), "tool result delivery must not compare a public protocol id with its internal foreign key");
	requireContract(source.includes('"preparation_attempt" INTEGER NOT NULL DEFAULT 0'), "provider-free preparation attempts must persist on the invocation");
	requireContract(source.includes('"retry_deadline_at" TIMESTAMP(3) NOT NULL'), "the five-minute provider-free retry deadline must persist on the invocation");
	requireContract(!source.includes('CREATE TABLE "runtime_external_action_retries"'), "the superseded split retry authority must stay removed");
}
requireContract(sql.includes('DROP TABLE "runtime_external_action_retries"'), "migration must drop the superseded retry authority");
requireContract(sql.includes('DELETE FROM "tool_invocations"'), "migration must explicitly discard the unfinished pre-release invocation format");
requireContract(sql.includes('DROP TYPE "ActionExecutionState"') === false, "migration must retain ActionExecutionState for proof-bound action receipts");
for (const source of [targetBaseline, sql])
{
	requireContract(source.includes('channel_runtime_routes_route_id_receiver_id_silo_id_agent_service_fkey') || source.includes('channel_invocation_contexts_route_id_receiver_id_silo_id_agent_service_fkey'), "invocation contexts must use a receiver-bound route foreign key");
	requireContract(source.includes("legacy-route-v0:"), "legacy receiver namespace must remain explicit");
	requireContract(source.includes('CREATE TRIGGER "channel_runtime_routes_evidence_guard"'), "route evidence mutations must remain trigger-guarded");
}
requireContract(targetBaseline.includes('"legacy_expires_at" TIMESTAMP(3)'), "fresh route expiry must survive only as nullable legacy evidence");
requireContract(targetBaseline.includes('"receiver_id" TEXT NOT NULL'), "fresh routes must bind a stable receiver");
requireContract(!targetBaseline.includes('channel_runtime_routes_expiry_after_registration'), "fresh route expiry must not remain active routing authority");
requireContract(sql.includes('RENAME COLUMN "expires_at" TO "legacy_expires_at"'), "migration must preserve route expiry under its legacy evidence name");
requireContract(sql.includes('ALTER COLUMN "receiver_id" SET NOT NULL'), "migrated routes must bind a stable receiver");
requireContract(sql.includes('DROP CONSTRAINT "channel_runtime_routes_expiry_after_registration"'), "migration must retire the route-expiry authority constraint");
requireContract(sql.includes('"receiver_id" = \'legacy-route-v0:\' || route."id"'), "migration must derive deterministic legacy receiver ids from preserved route ids");
requireContract(sql.includes('date_trunc(\'milliseconds\', clock_timestamp())::TIMESTAMP(3) AS "retired_at"'), "migration must retire every legacy route at one shared instant");
for (const eventType of ["tool.failed", "run.error", "a2ui.rendering.begun", "a2ui.surface.updated", "a2ui.data_model.updated"])
{
	requireContract(targetBaseline.includes(`'${eventType}'`), `target baseline must admit canonical ${eventType} events`);
	requireContract(sql.includes(`'${eventType}'`), `migration must admit canonical ${eventType} events`);
}
requireContract(sql.includes("IF OLD.\"state\" IN ('approved', 'denied', 'expired')"), "terminal approval markers must remain consumable");
requireContract(sql.includes('DROP TYPE "ConversationThreadState"'), "migration must remove the retired ConversationThread model");
requireContract(sql.includes('CREATE TYPE "ConversationMode"'), "migration must create immutable Conversation modes");
requireContract(sql.includes('CREATE TABLE "conversation_timeline_entries"'), "migration must create the canonical mixed timeline");
requireContract(
	conversationSchema.includes('updatedAt            DateTime                      @default(now()) @map("updated_at")'),
	"Conversation activity time must be database-defaulted rather than Prisma-managed",
);
requireContract(!conversationSchema.includes('updatedAt            DateTime                      @updatedAt'), "Conversation activity time must not be Prisma-managed");
requireContract(
	conversationSchema.includes('activitySequence     BigInt                        @default(autoincrement()) @unique @map("activity_sequence")'),
	"Conversation list order must use one database-generated global activity sequence",
);
requireContract(
	targetBaseline.includes('"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'),
	"target Conversation activity time must retain its database default",
);
requireContract(
	sql.includes('"updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP'),
	"migrated Conversation activity time must retain its database default",
);
for (const source of [targetBaseline, sql])
{
	requireContract(source.includes('"activity_sequence" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL'), "Conversation activity sequence must be generated-always database identity");
	requireContract(source.includes('CREATE UNIQUE INDEX "conversations_activity_sequence_key"'), "Conversation activity sequence must remain globally unique");
	requireContract(source.includes('"activity_sequence" = DEFAULT'), "canonical appends must allocate the next generated-always global activity sequence");
	requireContract(source.includes('conversations_silo_id_mode_lifecycle_activity_sequence_idx'), "Conversation catalogue index must order by global activity sequence");
	requireContract(!source.includes("conversation_activity_at + INTERVAL '1 millisecond'"), "per-conversation synthetic timestamp ordering must stay retired");
}
requireContract(sql.includes('CREATE SCHEMA "opencrane_migrations"'), "successful migration must create schema history authority");
requireContract(sql.includes("'0.8.0', '0.7.0'"), "schema history must bind the exact transition");
requireContract(sql.includes("migration_history_exists"), "migration must detect a prior completed transition");
requireContract(sql.includes("migration_already_applied"), "migration retry must require exact history and target evidence");
requireContract(sql.includes("already applied with exact history"), "exact deploy retries must succeed as a no-op");
requireContract(sql.indexOf("pg_advisory_lock") < sql.indexOf("migration_history_exists"), "retry detection must run under the session migration lock");
requireContract(sql.includes('"sql_sha256" = :\'migration_sql_sha256\''), "retry evidence must bind the supplied SQL digest");
requireContract(sql.includes('"sql_sha256" TEXT NOT NULL'), "schema history must retain the applied SQL digest");
requireContract(sql.match(/pg_advisory_unlock/gu)?.length === 2, "success and retry paths must release the session lock");
requireContract(sql.includes("COMMIT;\nSELECT pg_advisory_unlock"), "migration must commit before releasing its session lock");
requireContract(sql.trimEnd().endsWith("\\endif"), "migration retry branch must remain explicit");

const authorityFunctions = [
	"enforce_channel_runtime_route_evidence",
	"enforce_conversation_lifecycle",
	"enforce_conversation_timeline_entry",
	"enforce_persona_question_set_lifecycle",
	"enforce_persona_question_mutation",
	"enforce_persona_interview_lifecycle",
	"enforce_persona_answer_provenance",
	"enforce_persona_insight_provenance",
	"enforce_persona_revision_lifecycle",
	"enforce_persona_soul_template_rules",
	"reject_persona_source_mutation",
	"enforce_persona_score_provenance",
	"enforce_persona_tie_resolution_provenance",
	"enforce_user_onboarding_lifecycle",
	"enforce_user_onboarding_bootstrap_conversation",
	"enforce_user_onboarding_bootstrap_answer",
];
for (const name of authorityFunctions)
{
	const baselineStart = targetBaseline.indexOf(`CREATE FUNCTION "${name}"`);
	const baselineEnd = targetBaseline.indexOf("$$;", baselineStart) + 3;
	requireContract(baselineStart >= 0 && baselineEnd > 2, `target function ${name} must exist`);
	const targetFunction = targetBaseline.slice(baselineStart, baselineEnd);
	const migratedFunction = targetFunction.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
	requireContract(sql.includes(migratedFunction), `migration must carry exact target function ${name}`);
}

const seedStart = targetBaseline.indexOf('INSERT INTO "persona_question_sets"');
requireContract(seedStart >= 0, "target governed persona seeds must exist");
const seedEnd = targetBaseline.indexOf('\n-- CreateTable\nCREATE TABLE "artifact_scan_jobs"', seedStart);
requireContract(seedEnd > seedStart, "target governed persona seeds must have an exact boundary");
requireContract(sql.includes(targetBaseline.slice(seedStart, seedEnd)), "migration must carry the exact governed target seeds");

console.log("0.7.0-to-0.8.0 migration contract: PASS");

requireContract(organizationManifest.fromSchemaVersion === "0.8.0", "organization-member migration source version must be exact");
requireContract(organizationManifest.toSchemaVersion === "0.9.0", "organization-member migration target version must be exact");
requireContract(organizationManifest.sqlSha256 === organizationSqlDigest, "organization-member migration SQL digest must match its manifest");
requireContract(organizationManifest.targetBaselineSha256 === targetDigest, "organization-member migration target digest must match the clean baseline");
requireContract(
	JSON.stringify(organizationManifest.sourceProtectedBaselineSha256s) === JSON.stringify([
		"7ed3f49ec3b96276cfce1c1d41e97588b0970fb28352c7d933269ce201ce32fc",
		"25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d",
	]),
	"organization-member migration must admit fresh 0.8 and inherited 0.7 protected origins",
);
requireContract(
	organizationManifest.freshSourceProtectedBaselineSha256 === "7ed3f49ec3b96276cfce1c1d41e97588b0970fb28352c7d933269ce201ce32fc",
	"organization-member migration must identify the fresh 0.8 protected origin",
);
for (const admittedOrigin of organizationManifest.sourceProtectedBaselineSha256s)
{
	requireContract(organizationSql.includes(admittedOrigin), `organization-member migration must admit protected origin ${admittedOrigin}`);
}
requireContract(organizationSql.includes("pg_advisory_lock"), "organization-member migration must acquire the session migration lock");
requireContract(organizationSql.includes("pg_advisory_xact_lock"), "organization-member migration must hold a transaction migration lock");
requireContract(organizationSql.includes("BEGIN;"), "organization-member migration must run transactionally");
requireContract(organizationSql.includes("COMMIT;\nSELECT pg_advisory_unlock"), "organization-member migration must commit before releasing the session lock");
requireContract(organizationSql.includes("migration_already_applied"), "organization-member migration must support exact idempotent retry");
requireContract(organizationSql.includes("database does not match the expected 0.8.0 source shape"), "organization-member migration must fail closed on source-shape drift");
for (const source of [targetBaseline, organizationSql])
{
	requireContract(source.includes('CREATE TYPE "OrganizationInvitationStatus"'), "organization invitation state must exist in fresh and migrated schemas");
	requireContract(source.includes('CREATE TABLE "organization_invitations"'), "organization invitation authority must exist in fresh and migrated schemas");
	requireContract(source.includes('CREATE TABLE "organization_invitation_requests"'), "invitation idempotency authority must exist in fresh and migrated schemas");
	requireContract(source.includes('organization_invitations_silo_id_active_email_key'), "one pending invitation must own each silo email");
	requireContract(source.includes('organization_invitation_requests_silo_id_actor_subject_idempotency_key_key'), "create retry coordinates must be unique per silo and actor");
	requireContract(source.includes('CREATE FUNCTION "protect_org_membership_last_owner"'), "last active owner mutations must be guarded by the database");
	requireContract(source.includes('CREATE TRIGGER "org_memberships_last_owner_guard"'), "last-owner guard must run on membership changes");
}
requireContract(organizationSql.trimEnd().endsWith("\\endif"), "organization-member migration retry branch must remain explicit");

console.log("0.8.0-to-0.9.0 migration contract: PASS");
