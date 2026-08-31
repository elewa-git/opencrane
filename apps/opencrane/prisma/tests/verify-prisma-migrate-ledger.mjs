import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prismaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerRoot = join(prismaRoot, "prisma-migrations");
const baseline = readFileSync(join(ledgerRoot, "20260826000000_0_9_2_baseline/migration.sql"), "utf8");
const migration = readFileSync(join(ledgerRoot, "20260827000000_0_10_0_workflow_cutover/migration.sql"), "utf8");
const authorizationMigration = readFileSync(join(ledgerRoot, "20260829000000_central_authorization_authority/migration.sql"), "utf8");
const candidateForwardRepair = readFileSync(join(prismaRoot, "migrations/untagged-0.9.3-candidate-forward-repair/migration.sql"), "utf8");
const targetBaseline = readFileSync(join(prismaRoot, "bootstrap/target-baseline.sql"), "utf8");
const releasedCutoverChecksum = createHash("sha256").update(migration).digest("hex");

function _Require(condition, message)
{
	if (!condition) throw new Error(message);
}

function _RequireBefore(earlier, later, message)
{
	const earlierIndex = migration.indexOf(earlier);
	const laterIndex = migration.indexOf(later);
	_Require(earlierIndex >= 0 && laterIndex > earlierIndex, message);
}

function _RequireBeforeIn(source, earlier, later, message)
{
	const earlierIndex = source.indexOf(earlier);
	const laterIndex = source.indexOf(later);
	_Require(earlierIndex >= 0 && laterIndex > earlierIndex, message);
}

function _TargetFunction(name)
{
	const start = targetBaseline.indexOf(`CREATE FUNCTION "${name}"`);
	const end = targetBaseline.indexOf("$$;", start) + 3;
	_Require(start >= 0 && end > 2, `target function ${name} must exist`);
	return targetBaseline.slice(start, end);
}

function _MigrationFunction(name)
{
	const marker = `FUNCTION "${name}"`;
	const markerIndex = migration.indexOf(marker);
	const start = migration.lastIndexOf("CREATE", markerIndex);
	const end = migration.indexOf("$$;", markerIndex) + 3;
	_Require(markerIndex >= 0 && start >= 0 && end > 2, `cutover function ${name} must exist`);
	return migration.slice(start, end);
}

function _AuthorizationMigrationFunction(name)
{
	const marker = `FUNCTION "${name}"`;
	const markerIndex = authorizationMigration.indexOf(marker);
	const start = authorizationMigration.lastIndexOf("CREATE", markerIndex);
	const end = authorizationMigration.indexOf("$$;", markerIndex) + 3;
	_Require(markerIndex >= 0 && start >= 0 && end > 2, `central authorization function ${name} must exist`);
	return authorizationMigration.slice(start, end);
}

function _NormalizedSql(value)
{
	return value.replace(/\s+/gu, " ").trim();
}

function _NamedCheckConstraint(source, name)
{
	const marker = `ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "${name}" CHECK (`;
	const start = source.indexOf(marker);
	const end = source.indexOf("\n);", start) + 3;
	_Require(start >= 0 && end > 2, `provider effect constraint ${name} must exist`);
	return source.slice(start, end);
}

function _CanonicalJson(value)
{
	if (Array.isArray(value)) return `[${value.map(_CanonicalJson).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(function _Entry(key) { return `${JSON.stringify(key)}:${_CanonicalJson(value[key])}`; }).join(",")}}`;
	return JSON.stringify(value);
}

function _ProductAuthorizationCatalogue(sql)
{
	const match = /'capability-catalog-opencrane-product-authorization-v1',\s*'opencrane-product-authorization',\s*1,\s*'(sha256:[0-9a-f]{64})',\s*'(\[[^']+\])'::jsonb/su.exec(sql);
	_Require(match !== null, "central product-authorization catalogue must be installed exactly once");
	return { digest: match[1], payload: JSON.parse(match[2]) };
}
const ledgerDirectories = readdirSync(ledgerRoot, { withFileTypes: true }).filter(function _IsDirectory(entry) { return entry.isDirectory(); });
_Require(ledgerDirectories.every(function _HasMigrationSql(entry) { return existsSync(join(ledgerRoot, entry.name, "migration.sql")); }), "every Prisma migration directory must contain migration.sql");

const baselineStatements = baseline
	.split("\n")
	.filter(function _IsSql(line) { return line.trim() !== "" && !line.trimStart().startsWith("--"); });
_Require(baselineStatements.length === 0, "the tagged 0.9.2 Prisma bridge must remain a no-op");
_Require(releasedCutoverChecksum === "fbdb206c00e4a41b60be7b0daf3cb1a01459abc48a5ddb7982275ec449b6547a", "the rebuilt untagged 0.10.0 cutover migration must retain its reviewed checksum");

_Require(migration.startsWith("-- OpenCrane 0.9.2 to 0.10.0 workflow and OCI cutover after the reviewed IAM prerequisite."), "the forward migration must name its exact release boundary");
_Require(migration.match(/^BEGIN;$/gmu)?.length === 1, "the forward migration must open one transaction");
_Require(migration.match(/^COMMIT;$/gmu)?.length === 1, "the forward migration must commit one transaction");
_Require(migration.trimEnd().endsWith("COMMIT;"), "the forward migration must finish with its transaction commit");
for (const retiredRuntimeTable of ["skill_workload_bootstraps", "skill_workloads", "run_outbox_events"])
{
	_Require(migration.includes(`DROP TABLE IF EXISTS "${retiredRuntimeTable}"`), `the rebuilt cutover must delete ${retiredRuntimeTable}`);
	_Require(!migration.includes(`CREATE TABLE "${retiredRuntimeTable}"`), `the rebuilt cutover must not recreate ${retiredRuntimeTable}`);
}
_Require(!migration.includes('CREATE FUNCTION "select_skill_workload_claim_candidate"'), "the rebuilt cutover must not reinstall the retired SQL workload selector");
_Require(!migration.includes('CREATE TRIGGER "run_outbox_events_monotonic"'), "the rebuilt cutover must not reinstall the retired run-outbox authority");

_Require(authorizationMigration.match(/^BEGIN;$/gmu)?.length === 1, "the central authorization migration must open one transaction");
_Require(authorizationMigration.match(/^COMMIT;$/gmu)?.length === 1, "the central authorization migration must commit one transaction");
_Require(authorizationMigration.trimEnd().endsWith("COMMIT;"), "the central authorization migration must finish with its transaction commit");
const workloadBootstrapAudienceConstraint = 'ALTER TABLE "workload_bootstraps" ADD CONSTRAINT "workload_bootstraps_audience_check" CHECK ("audience" IN (\'opencrane-agent-runtime\', \'opencrane-managed-agent-runtime\'));';
_Require(targetBaseline.includes(workloadBootstrapAudienceConstraint), "fresh databases must admit both governed workload bootstrap audiences");
_Require(authorizationMigration.includes('ALTER TABLE "workload_bootstraps" DROP CONSTRAINT "workload_bootstraps_audience_check";'), "the upgrade must replace the narrower workload bootstrap audience authority");
_Require(authorizationMigration.includes(workloadBootstrapAudienceConstraint), "the upgrade must admit both governed workload bootstrap audiences");
_Require(
	_NormalizedSql(_AuthorizationMigrationFunction("enforce_conversation_participant_coordinates").replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")) === _NormalizedSql(_TargetFunction("enforce_conversation_participant_coordinates")),
	"fresh and upgraded databases must allocate the same ConversationParticipant access-end authority",
);
_Require(
	_NormalizedSql(_AuthorizationMigrationFunction("enforce_workload_bootstrap_consumption").replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")) === _NormalizedSql(_TargetFunction("enforce_workload_bootstrap_consumption")),
	"fresh and upgraded databases must install the same irreversible WorkloadBootstrap revocation authority",
);
for (const bootstrapRevocationInvariant of ["WorkloadBootstrap revocation is irreversible", "WorkloadBootstrap is already revoked", "a revoked WorkloadBootstrap cannot be consumed"])
{
	_Require(targetBaseline.includes(bootstrapRevocationInvariant), `WorkloadBootstrap authority must retain invariant: ${bootstrapRevocationInvariant}`);
}
for (const name of [
	"enforce_conversation_run_event_append",
	"enforce_conversation_timeline_entry",
	"enforce_child_run_completion_delivery",
	"enforce_child_run_completion_delivery_event",
	"enforce_terminal_agent_run_event",
])
{
	_Require(
		_NormalizedSql(_AuthorizationMigrationFunction(name).replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")) === _NormalizedSql(_TargetFunction(name)),
		`fresh and upgraded databases must install the exact attempt-bound function ${name}`,
	);
}
for (const guard of [
	"OC_RUN_EVENT_ATTEMPT_BACKFILL_RESET_REQUIRED",
	"OC_CHILD_DELIVERY_ATTEMPT_BACKFILL_RESET_REQUIRED",
	"OC_CHILD_DELIVERY_TIMELINE_RESET_REQUIRED",
	"OC_ASSET_RUN_EVENT_ATTEMPT_RESET_REQUIRED",
])
{
	_Require(authorizationMigration.includes(guard), `the attempt-bound upgrade must fail closed with ${guard}`);
}
_Require(authorizationMigration.includes('ALTER TABLE "conversation_run_events" ADD COLUMN "attempt" INTEGER;'), "the upgrade must add the RunEvent attempt coordinate before making it required");
_RequireBeforeIn(authorizationMigration, 'DROP TRIGGER "conversation_run_events_append_only" ON "conversation_run_events";', 'UPDATE "conversation_run_events" SET "attempt" = 1;', "the upgrade must suspend the append-only event guard only while backfilling immutable history");
_RequireBeforeIn(authorizationMigration, 'UPDATE "conversation_run_events" SET "attempt" = 1;', 'ALTER TABLE "conversation_run_events" ALTER COLUMN "attempt" SET NOT NULL;', "the upgrade must deterministically backfill RunEvent attempts before requiring them");
_RequireBeforeIn(authorizationMigration, 'UPDATE "conversation_run_events" SET "attempt" = 1;', 'CREATE TRIGGER "conversation_run_events_append_only" BEFORE UPDATE OR DELETE ON "conversation_run_events"', "the upgrade must restore append-only RunEvent authority after backfill");
_RequireBeforeIn(authorizationMigration, 'DROP TRIGGER "child_run_completion_deliveries_authority" ON "child_run_completion_deliveries";', 'UPDATE "child_run_completion_deliveries" delivery', "the upgrade must suspend child-delivery immutability only while deriving historical coordinates");
_RequireBeforeIn(authorizationMigration, 'UPDATE "child_run_completion_deliveries" delivery', 'CREATE TRIGGER "child_run_completion_deliveries_authority" BEFORE INSERT OR UPDATE OR DELETE ON "child_run_completion_deliveries"', "the upgrade must restore child-delivery authority after backfill");
_Require(authorizationMigration.includes('ALTER TABLE "child_run_completion_deliveries" ADD CONSTRAINT "child_run_completion_deliveries_pkey" PRIMARY KEY ("child_run_id", "child_attempt", "parent_attempt");'), "the upgrade must install the approved child-delivery attempt identity");
_Require(authorizationMigration.includes('CREATE UNIQUE INDEX "child_run_completion_deliveries_one_delivery_per_attempt" ON "child_run_completion_deliveries"("child_run_id", "child_attempt") WHERE "outcome" = \'delivered\';'), "the upgrade must permit at most one delivered result per child attempt");
_Require(authorizationMigration.includes('ALTER TABLE "conversation_timeline_entries" DROP COLUMN "parent_delivery_child_run_id";'), "the upgrade must delete the callerless child parent-delivery timeline relation");
_Require(!targetBaseline.includes('"parent_delivery_child_run_id"'), "fresh databases must not retain the callerless child parent-delivery timeline relation");
_Require(targetBaseline.includes('CREATE UNIQUE INDEX "conversation_run_events_conversation_id_run_id_attempt_sequ_key" ON "conversation_run_events"("conversation_id", "run_id", "attempt", "sequence");'), "fresh databases must expose the exact four-coordinate RunEvent identity");
_Require(targetBaseline.includes('CREATE UNIQUE INDEX "child_run_completion_deliveries_one_delivery_per_attempt"'), "fresh databases must permit only one delivered result per child attempt");
_Require(targetBaseline.includes('CREATE INDEX "conversation_run_events_run_id_attempt_message_id_idx"'), "fresh databases must index messages inside their exact run attempt");
_Require(!targetBaseline.includes('CREATE INDEX "conversation_run_events_run_id_message_id_idx"'), "fresh databases must remove the attemptless RunEvent message index");
_Require(authorizationMigration.includes('DROP TABLE "action_execution_receipts";'), "the central authorization migration must remove the replaced proof-bound receipt table");
_Require(authorizationMigration.includes('DROP FUNCTION "enforce_action_execution_receipt_lifecycle"();'), "the central authorization migration must remove the replaced receipt trigger function");
_Require(authorizationMigration.includes('DROP TYPE "ActionExecutionState";'), "the central authorization migration must remove the replaced receipt state type");
_Require(authorizationMigration.includes('DROP TYPE "ActionReplayMode";'), "the central authorization migration must remove the replaced replay type");
_Require(!targetBaseline.includes('CREATE TABLE "action_execution_receipts"'), "fresh databases must not install the replaced proof-bound receipt table");
_Require(!targetBaseline.includes('"require_approval"'), "fresh AuthorizationGrant rows must not retain the unused approval flag");
_Require(!targetBaseline.includes('"resume_token_hash"'), "fresh ApprovalRequest rows must not retain the unused resume token hash");
_Require(authorizationMigration.match(/"require_approval"/gu)?.length === 1 && authorizationMigration.includes('ALTER TABLE "authorization_grants" DROP COLUMN "require_approval";'), "the upgrade must delete AuthorizationGrant.requireApproval without writing new values");
_Require(authorizationMigration.match(/"resume_token_hash"/gu)?.length === 1 && authorizationMigration.includes('ALTER TABLE "approval_requests" DROP COLUMN "resume_token_hash";'), "the upgrade must delete ApprovalRequest.resumeTokenHash without retaining token lifecycle logic");
_Require(!targetBaseline.includes('"catalog_id" TEXT,\n    "catalog_revision" INTEGER,\n    "catalog_digest" TEXT,\n    "capability_id" TEXT,\n    "resource_kind" TEXT NOT NULL'), "fresh ApprovalRequest rows must not duplicate capability-catalog coordinates");
for (const requiredApprovalField of ["elicitation_request_id", "tool_invocation_row_id", "reviewed_tool_arguments", "reviewed_tool_schema", "reviewed_tool_schema_digest", "safe_proposed_arguments", "response_schema"])
{
	_Require(new RegExp(`"${requiredApprovalField}" (?:TEXT|JSONB) NOT NULL`).test(targetBaseline), `fresh ApprovalRequest rows must require ${requiredApprovalField}`);
	_Require(authorizationMigration.includes(`ALTER TABLE "approval_requests" ALTER COLUMN "${requiredApprovalField}" SET NOT NULL;`), `the upgrade must require ${requiredApprovalField} after deleting pre-cutover approvals`);
}
_Require(authorizationMigration.includes('CREATE TEMP TABLE "precentral_approval_requests"'), "the upgrade must snapshot every pre-cutover ApprovalRequest");
_Require(authorizationMigration.includes('SELECT "id", "elicitation_request_id"\n  FROM "approval_requests";'), "the approval cutoff must include linked and callerless legacy ApprovalRequest rows");
_Require(authorizationMigration.includes('CREATE TEMP TABLE "precentral_elicitation_requests"'), "the upgrade must snapshot every elicitation owned by removed approval and personal-memory work");
_Require(authorizationMigration.includes('JOIN "precentral_tool_invocations" invocation ON invocation."id" = receipt."tool_invocation_id"'), "the elicitation cutoff must include personal-memory requests linked to removed invocations");
_Require(authorizationMigration.includes('request_row."purpose_payload"->>\'toolInvocationId\'') && authorizationMigration.includes('request_row."purpose" = \'personal_memory_permission\'::"ElicitationPurpose"'), "the elicitation cutoff must include unresolved personal-memory requests whose only invocation link is purpose payload JSON");
_Require(authorizationMigration.includes('request_row."purpose_payload"->>\'approvalRequestId\'') && authorizationMigration.includes('request_row."purpose" = \'tool_approval\'::"ElicitationPurpose"'), "the elicitation cutoff must include legacy tool approvals whose only approval link is purpose payload JSON");
for (const approvalColumn of ["catalog_id", "catalog_revision", "catalog_digest", "capability_id"])
{
	_Require(authorizationMigration.includes(`ALTER TABLE "approval_requests" DROP COLUMN "${approvalColumn}";`), `the upgrade must remove callerless ApprovalRequest field ${approvalColumn}`);
}
for (const dependentDelete of [
	'DELETE FROM "elicitation_response_attempts"',
	'DELETE FROM "elicitation_result_deliveries"',
	'DELETE FROM "authorization_grants"\n WHERE "resource_kind" = \'approval-request\'',
	'DELETE FROM "approval_requests"\n WHERE "id" IN (SELECT "id" FROM "precentral_approval_requests")',
	'DELETE FROM "elicitation_requests"\n WHERE "id" IN (SELECT "id" FROM "precentral_elicitation_requests")',
])
{
	_Require(authorizationMigration.includes(dependentDelete), `pre-cutover approval cleanup is missing dependency step ${dependentDelete}`);
}
_RequireBeforeIn(authorizationMigration, 'DELETE FROM "elicitation_response_attempts"', 'DELETE FROM "elicitation_requests"', "response attempts must be deleted before their elicitation requests");
_RequireBeforeIn(authorizationMigration, 'DELETE FROM "elicitation_result_deliveries"', 'DELETE FROM "elicitation_requests"', "result deliveries must be deleted before their elicitation requests");
_RequireBeforeIn(authorizationMigration, 'DELETE FROM "authorization_grants"\n WHERE "resource_kind" = \'approval-request\'', 'DELETE FROM "approval_requests"\n WHERE "id" IN (SELECT "id" FROM "precentral_approval_requests")', "approval grants must be deleted before their pre-cutover resources");
_RequireBeforeIn(authorizationMigration, 'DELETE FROM "approval_requests"\n WHERE "id" IN (SELECT "id" FROM "precentral_approval_requests")', 'DELETE FROM "elicitation_requests"', "ApprovalRequest rows must be deleted before their elicitation requests");
_Require(authorizationMigration.includes('OR "request_id" IN (SELECT "id" FROM "precentral_elicitation_requests")'), "personal-memory receipts must be deleted by the captured elicitation relation as well as the invocation relation");
_Require(authorizationMigration.includes('receipt JOIN "precentral_elicitation_requests" legacy ON legacy."id" = receipt."request_id"'), "the residue assertion must reject a personal-memory receipt left behind through an elicitation relation");
_Require(authorizationMigration.includes('DELETE FROM "authorization_grants"\nWHERE "catalog_id" = \'opencrane-core\''), "the central authorization migration must remove translated legacy MCP grants");
_Require(authorizationMigration.includes('DELETE FROM "capability_catalog_revisions"\nWHERE "catalog_id" = \'opencrane-core\''), "the central authorization migration must remove the superseded legacy MCP catalogue");
_RequireBeforeIn(authorizationMigration, "-- Translate the legacy MCP-use grant", 'DELETE FROM "authorization_grants"\nWHERE "catalog_id" = \'opencrane-core\'', "legacy MCP grants must be translated before their source rows are deleted");
_RequireBeforeIn(authorizationMigration, 'DELETE FROM "authorization_grants"\nWHERE "catalog_id" = \'opencrane-core\'', 'DELETE FROM "capability_catalog_revisions"\nWHERE "catalog_id" = \'opencrane-core\'', "legacy MCP grants must be deleted before their catalogue revision");
_Require(!targetBaseline.includes("'capability-catalog-opencrane-core-v1'"), "fresh databases must not seed the retired legacy MCP catalogue");
_Require(!targetBaseline.includes("'opencrane-core'"), "fresh databases must not retain the retired legacy MCP catalogue identifier");
_Require(authorizationMigration.includes('CREATE TEMP TABLE "precentral_tool_invocations"'), "the central authorization migration must identify every pre-central ToolInvocation");
_Require(authorizationMigration.includes('SELECT "id"\n  FROM "tool_invocations";'), "the hard cutoff must include terminal and task-owned pre-central ToolInvocation rows");
const precentralToolCapture = authorizationMigration.slice(
	authorizationMigration.indexOf('CREATE TEMP TABLE "precentral_tool_invocations"'),
	authorizationMigration.indexOf('CREATE TEMP TABLE "precentral_approval_requests"'),
);
_Require(!precentralToolCapture.includes('"state" NOT IN'), "the pre-1.0 cutoff must not retain terminal ToolInvocation compatibility");
for (const retiredRuntimeTable of ["skill_workload_bootstraps", "skill_workloads", "run_outbox_events"])
{
	_Require(authorizationMigration.includes(`DROP TABLE IF EXISTS "${retiredRuntimeTable}";`), `the central cutover must retire candidate table ${retiredRuntimeTable}`);
}
for (const retiredRuntimeView of ["skill_workload_claim_candidates", "skill_workload_release_claim_candidates"])
{
	_Require(authorizationMigration.includes(`DROP VIEW IF EXISTS "${retiredRuntimeView}";`), `the central cutover must retire candidate view ${retiredRuntimeView}`);
}
for (const retiredRuntimeFunction of [
	"select_skill_workload_claim_candidate",
	"select_skill_workload_release_claim_candidate",
	"enforce_skill_workload_bootstrap",
	"enforce_skill_workload_authority",
	"cancel_ineligible_skill_workloads",
	"enforce_accepted_outbox_attempt",
	"enforce_run_outbox_event_update",
])
{
	_Require(authorizationMigration.includes(`DROP FUNCTION IF EXISTS "${retiredRuntimeFunction}"();`), `the central cutover must retire candidate function ${retiredRuntimeFunction}`);
}
for (const retiredRuntimeType of ["SkillWorkloadKind", "SkillWorkloadState", "RunOutboxEventKind"])
{
	_Require(authorizationMigration.includes(`DROP TYPE IF EXISTS "${retiredRuntimeType}";`), `the central cutover must retire candidate type ${retiredRuntimeType}`);
}
_RequireBeforeIn(authorizationMigration, 'DROP TRIGGER IF EXISTS "cancel_ineligible_skill_workloads_on_revision"', 'DROP VIEW IF EXISTS "skill_workload_claim_candidates"', "external workload cancellation triggers must be removed before their views and functions");
_RequireBeforeIn(authorizationMigration, 'DROP VIEW IF EXISTS "skill_workload_release_claim_candidates"', 'DROP FUNCTION IF EXISTS "select_skill_workload_claim_candidate"()', "candidate workload views must release their selector functions before those functions are removed");
_RequireBeforeIn(authorizationMigration, 'DROP FUNCTION IF EXISTS "select_skill_workload_release_claim_candidate"()', 'DROP TABLE IF EXISTS "skill_workload_bootstraps"', "candidate workload selectors must release their table row types before the source tables are removed");
_RequireBeforeIn(authorizationMigration, 'DROP TABLE IF EXISTS "skill_workload_bootstraps"', 'DROP TABLE IF EXISTS "skill_workloads"', "candidate workload bootstrap rows must be dropped before their parent workloads");
_RequireBeforeIn(authorizationMigration, 'DROP TABLE IF EXISTS "skill_workloads"', 'DROP FUNCTION IF EXISTS "enforce_skill_workload_bootstrap"()', "candidate workload tables must release their trigger dependencies before their enforcement functions are dropped");
_Require(
	_NormalizedSql(_AuthorizationMigrationFunction("enforce_agent_run_authority_update").replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")) === _NormalizedSql(_TargetFunction("enforce_agent_run_authority_update")),
	"the central cutover must replace candidate AgentRun outbox authority with the exact target workflow authority",
);
_RequireBeforeIn(authorizationMigration, 'CREATE OR REPLACE FUNCTION "enforce_agent_run_authority_update"()', 'DROP TABLE IF EXISTS "run_outbox_events"', "AgentRun authority must stop querying the legacy outbox before that table and enum are removed");
_RequireBeforeIn(authorizationMigration, 'DROP TABLE IF EXISTS "run_outbox_events"', 'DROP TYPE IF EXISTS "RunOutboxEventKind"', "the legacy run outbox table must release its enum before the enum is removed");
for (const dependentDelete of [
	'DELETE FROM "personal_memory_permission_receipts"',
	'DELETE FROM "approval_requests"',
	'DELETE FROM "tool_result_deliveries"',
	'DELETE FROM "mcp_runtime_executions"',
	'DELETE FROM "tool_invocations"',
])
{
	_Require(authorizationMigration.includes(dependentDelete), `pre-central ToolInvocation cleanup is missing dependency step ${dependentDelete}`);
}
_RequireBeforeIn(authorizationMigration, 'DROP TRIGGER IF EXISTS "tool_invocations_lifecycle_guard"', 'DELETE FROM "tool_invocations"', "the migration must open the deletion guard before removing unfinished invocations");
_RequireBeforeIn(authorizationMigration, 'DELETE FROM "tool_invocations"', 'CREATE TRIGGER "tool_invocations_lifecycle_guard"', "the migration must restore ToolInvocation deletion authority after its approved cutoff");
_RequireBeforeIn(authorizationMigration, 'DELETE FROM "tool_invocations"', 'CREATE FUNCTION "enforce_tool_invocation_authorization_evidence"', "pre-central invocations must be removed before central evidence becomes mandatory");
_Require(authorizationMigration.includes("pre-central ToolInvocation cleanup left durable runtime residue"), "the migration must fail if a pre-central invocation or dependent runtime row survives cleanup");
for (const globalModelIndex of [
	'CREATE UNIQUE INDEX "provider_credentials_global_provider_key" ON "provider_credentials"("silo_id", "provider") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL',
	'CREATE UNIQUE INDEX "model_definitions_global_public_model_name_key" ON "model_definitions"("silo_id", "public_model_name") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL',
	'CREATE UNIQUE INDEX "model_definitions_global_default_key" ON "model_definitions"("silo_id") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL AND "is_default"',
	'CREATE UNIQUE INDEX "model_definitions_silo_id_litellm_model_id_key" ON "model_definitions"("silo_id", "litellm_model_id")',
	'CREATE UNIQUE INDEX "model_routing_defaults_global_key" ON "model_routing_defaults"("silo_id") WHERE "scope" = \'global\' AND "cluster_tenant" IS NULL',
])
{
	_Require(authorizationMigration.includes(globalModelIndex), `the upgrade must install global model authority: ${globalModelIndex}`);
	_Require(targetBaseline.includes(globalModelIndex), `fresh databases must install global model authority: ${globalModelIndex}`);
}
_Require(authorizationMigration.includes("cannot install global model alias authority: duplicate public model names exist"), "the upgrade must reject duplicate global public model names before installing authority");
_Require(authorizationMigration.includes("cannot install global model default authority: multiple global defaults exist"), "the upgrade must reject multiple global defaults before installing authority");
_RequireBeforeIn(authorizationMigration, "cannot install global model alias authority: duplicate public model names exist", 'CREATE UNIQUE INDEX "model_definitions_global_public_model_name_key"', "the upgrade must check global alias duplicates before creating its index");
_RequireBeforeIn(authorizationMigration, "cannot install global model default authority: multiple global defaults exist", 'CREATE UNIQUE INDEX "model_definitions_global_default_key"', "the upgrade must check global defaults before creating its index");
_Require(authorizationMigration.includes("expected one admitted silo"), "the upgrade must fail closed when unreferenced provider rows cannot be mapped to one admitted silo");
_RequireBeforeIn(authorizationMigration, 'DROP INDEX "model_definitions_litellm_model_id_key"', 'CREATE UNIQUE INDEX "model_definitions_silo_id_litellm_model_id_key"', "the upgrade must replace the installation-wide LiteLLM deployment fence with the silo-local fence");
_Require(!targetBaseline.includes('CREATE UNIQUE INDEX "model_definitions_litellm_model_id_key" ON "model_definitions"("litellm_model_id")'), "fresh databases must not retain an installation-wide LiteLLM deployment fence");
_Require(!authorizationMigration.includes('CREATE UNIQUE INDEX "provider_effect_commands_kind_resource_id_resource_revision_key"'), "the upgrade must not create an installation-wide provider command identity fence");
_Require(!targetBaseline.includes('CREATE UNIQUE INDEX "provider_effect_commands_kind_resource_id_resource_revision_key"'), "fresh databases must not create an installation-wide provider command identity fence");
for (const siloFence of [
	'ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_agent_service_id_silo_id_fkey"',
	'ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_model_definition_id_silo_id_fkey"',
	'ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_parent_revision_id_silo_id_fkey"',
	'ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_source_revision_id_silo_id_fkey"',
	'ALTER TABLE "model_definitions" ADD CONSTRAINT "model_definitions_provider_credential_id_silo_id_fkey"',
])
{
	_Require(authorizationMigration.includes(siloFence), `the upgrade must install the cross-silo fence: ${siloFence}`);
	_Require(targetBaseline.includes(siloFence), `fresh databases must install the cross-silo fence: ${siloFence}`);
}
_Require(authorizationMigration.includes('CREATE TABLE "run_model_credential_mint_authorizations"'), "the central authorization migration must install the one-use model-key effect admission");
_Require(targetBaseline.includes('CREATE TABLE "run_model_credential_mint_authorizations"'), "fresh databases must install the one-use model-key effect admission");
for (const marker of [
	'CREATE TYPE "ProviderEffectCommandKind" AS ENUM (\'set_byok_key\', \'delete_byok_key\', \'register_model\')',
	'CREATE TYPE "ProviderEffectCommandState" AS ENUM (\'pending\', \'awaiting_material\', \'claimed\', \'succeeded\', \'failed\')',
	'CREATE TYPE "ProviderEffectMaterialRequirement" AS ENUM (\'none\', \'ephemeral_provider_key\')',
	'CREATE TABLE "provider_effect_commands"',
	'"desired_generation" INTEGER NOT NULL',
	'CREATE INDEX "provider_effect_commands_silo_id_resource_kind_resource_id__idx" ON "provider_effect_commands"("silo_id", "resource_kind", "resource_id", "desired_generation" DESC)',
	'CREATE INDEX "provider_effect_commands_state_claim_expires_at_idx"',
	'CREATE INDEX "provider_effect_commands_follow_up_command_id_idx" ON "provider_effect_commands"("follow_up_command_id")',
	'CREATE INDEX "provider_effect_commands_silo_id_created_at_idx"',
	'CREATE UNIQUE INDEX "provider_effect_commands_silo_kind_resource_revision_key" ON "provider_effect_commands"("silo_id", "kind", "resource_id", "resource_revision")',
	'CREATE UNIQUE INDEX "provider_effect_commands_silo_id_resource_kind_resource_id__key" ON "provider_effect_commands"("silo_id", "resource_kind", "resource_id", "desired_generation")',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_identity_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_material_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_claim_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_completion_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_follow_up_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_payload_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_resource_binding_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_follow_up_command_id_fkey" FOREIGN KEY ("follow_up_command_id") REFERENCES "provider_effect_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
])
{
	_Require(authorizationMigration.includes(marker), `the 0.9.2-to-0.10.0 path must install provider effect authority: ${marker}`);
	_Require(targetBaseline.includes(marker), `fresh databases must install provider effect authority: ${marker}`);
}
for (const invariant of [
	'"arguments_digest" ~ \'^sha256:[0-9a-f]{64}$\'',
	'"desired_generation" > 0',
	'"material_verifier" IS NOT NULL AND "material_verifier" ~ \'^sha256:[0-9a-f]{64}$\'',
	'"state" = \'claimed\' AND "claim_fence" IS NOT NULL',
	'"state" = \'succeeded\' AND "completed_at" IS NOT NULL AND "result" IS NOT NULL',
	'"follow_up_command_id" IS NULL',
	'"kind" = \'set_byok_key\' AND "state" = \'succeeded\' AND "follow_up_command_id" <> "id"',
	'"payload" - ARRAY[\'provider\', \'secretRef\', \'litellmCredentialName\'] = \'{}\'::jsonb',
	'"payload" - ARRAY[\'provider\', \'secretRef\', \'litellmCredentialName\', \'litellmRegistered\', \'modelDefinitionIds\', \'deployments\'] = \'{}\'::jsonb',
	'jsonb_typeof("payload"->\'litellmRegistered\') = \'boolean\'',
	'jsonb_typeof("payload"->\'modelDefinitionIds\') = \'array\'',
	'jsonb_typeof("payload"->\'deployments\') = \'array\'',
	'"payload" - ARRAY[\'modelDefinitionId\', \'publicModelName\', \'upstreamModel\', \'scope\', \'clusterTenant\', \'apiBase\', \'apiKeyEnvRef\', \'litellmCredentialName\', \'routingDefaultId\', \'selectedModelDefinitionId\'] = \'{}\'::jsonb',
	'jsonb_typeof("payload"->\'routingDefaultId\') = \'null\' AND jsonb_typeof("payload"->\'selectedModelDefinitionId\') = \'null\'',
	'"payload"->>\'selectedModelDefinitionId\' <> "payload"->>\'modelDefinitionId\'',
	'"payload"->>\'scope\' = \'global\'',
	'"payload"->>\'publicModelName\' = \'auto\'',
	'"resource_kind" = \'model-definition\'',
	'"payload"->>\'modelDefinitionId\' = "resource_id"',
	'"resource_kind" = \'provider-connection\'',
	'"resource_id" = \'byok:\' || "silo_id" || \':\' || ("payload"->>\'provider\')',
])
{
	_Require(authorizationMigration.includes(invariant), `the provider effect upgrade is missing authority invariant: ${invariant}`);
	_Require(targetBaseline.includes(invariant), `the fresh provider effect table is missing authority invariant: ${invariant}`);
}
const providerEffectCompletionConstraint = `ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_completion_check" CHECK (
    ("state" = 'succeeded' AND "completed_at" IS NOT NULL AND "result" IS NOT NULL AND "failure_code" IS NULL)
    OR ("state" = 'failed' AND "completed_at" IS NOT NULL AND "result" IS NULL AND "failure_code" IS NOT NULL AND btrim("failure_code") <> '')
    OR ("state" = 'claimed' AND "completed_at" IS NULL AND "result" IS NOT NULL AND "failure_code" = 'provider_effect_finalization_blocked')
    OR ("state" IN ('pending', 'awaiting_material', 'claimed') AND "completed_at" IS NULL AND "result" IS NULL AND ("failure_code" IS NULL OR (btrim("failure_code") <> '' AND "failure_code" <> 'provider_effect_finalization_blocked')))
);`;
for (const [source, label] of [[authorizationMigration, "upgrade"], [targetBaseline, "fresh baseline"]])
{
	_Require(
		_NormalizedSql(_NamedCheckConstraint(source, "provider_effect_commands_completion_check")) === _NormalizedSql(providerEffectCompletionConstraint),
		`${label} provider effect completion authority must retain blocked finalization evidence only on an unfinished claimed command`,
	);
}
const providerEffectFollowUpConstraint = `ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_follow_up_check" CHECK (
    "follow_up_command_id" IS NULL
    OR ("kind" = 'set_byok_key' AND "state" = 'succeeded' AND "follow_up_command_id" <> "id")
);`;
for (const [source, label] of [[authorizationMigration, "upgrade"], [targetBaseline, "fresh baseline"]])
{
	_Require(
		_NormalizedSql(_NamedCheckConstraint(source, "provider_effect_commands_follow_up_check")) === _NormalizedSql(providerEffectFollowUpConstraint),
		`${label} provider effect follow-up evidence must belong only to a succeeded Set-BYOK parent`,
	);
}
_RequireBeforeIn(authorizationMigration, 'CREATE TYPE "ProviderEffectCommandKind"', 'CREATE TABLE "provider_effect_commands"', "provider effect enums must exist before the upgrade creates its command table");
_RequireBeforeIn(authorizationMigration, 'CREATE TABLE "provider_effect_commands"', 'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_payload_check"', "the provider effect table must exist before the upgrade installs its payload authority");
for (const legacyTable of ["token_usage_snapshots", "global_budget_settings", "account_budget_settings", "third_party_sources"])
{
	_Require(authorizationMigration.includes(`EXISTS (SELECT 1 FROM "${legacyTable}")`), `the central authorization migration must reject unowned ${legacyTable} rows`);
}
_Require(authorizationMigration.includes('WHERE "silo_id" IS NULL OR btrim("silo_id") = \'\''), "the central authorization migration must reject unattributed audit rows");
_Require(authorizationMigration.includes("their silo ownership cannot be derived safely"), "the central authorization migration must explain its remaining ownership cutoff");
_Require(authorizationMigration.includes("ERRCODE = 'OC713'"), "the central authorization migration must expose the legacy ownership cutoff as OC713");
_Require(candidateForwardRepair.includes("untagged-0.9.3-candidate-to-0.10.0"), "the exact untagged candidate must record a distinct forward repair");
_Require(candidateForwardRepair.includes("organization.invitations.created") && candidateForwardRepair.includes('invitation."silo_id" = current_setting(\'opencrane.migration_silo_id\')'), "the forward repair must derive every legacy invitation audit row from exact silo evidence");
for (const sourceChecksum of [
	"eb429e29c15495608c5e3d50c6d7904ea6e015ea5fc6eff631a310bc6f2ae5fa",
	"d7229f9995c5c881dd1b4da3dae6d972cb6827e00fca4b7d21fb1c8a48b13f84",
	"6a4256041ba5a78c6e849531c4d9fffea2cad5afef509344c088e566bcfa0004",
])
	_Require(candidateForwardRepair.includes(sourceChecksum), `the forward repair must fail closed on source checksum ${sourceChecksum}`);
for (const scopedColumn of [
	'CREATE TABLE "audit_log" (\n    "id" SERIAL NOT NULL,\n    "silo_id" TEXT NOT NULL',
	'CREATE TABLE "token_usage_snapshots" (\n    "id" SERIAL NOT NULL,\n    "silo_id" TEXT NOT NULL',
	'CREATE TABLE "global_budget_settings" (\n    "id" INTEGER NOT NULL DEFAULT 1,\n    "silo_id" TEXT NOT NULL',
	'CREATE TABLE "account_budget_settings" (\n    "silo_id" TEXT NOT NULL',
	'CREATE TABLE "third_party_sources" (\n    "id" TEXT NOT NULL,\n    "silo_id" TEXT NOT NULL',
])
{
	_Require(targetBaseline.includes(scopedColumn), `fresh databases must install scoped storage: ${scopedColumn.split("\n")[0]}`);
}
for (const siloKey of [
	'audit_log_silo_id_timestamp_id_idx" ON "audit_log"("silo_id", "timestamp", "id")',
	'token_usage_snapshots_silo_id_user_id_currency_key" ON "token_usage_snapshots"("silo_id", "user_id", "currency")',
	'global_budget_settings_pkey" PRIMARY KEY ("silo_id", "id")',
	'account_budget_settings_pkey" PRIMARY KEY ("silo_id", "user_id")',
	'third_party_sources_silo_id_name_key" ON "third_party_sources"("silo_id", "name")',
])
{
	const compactKey = siloKey.replace(/\s+/gu, "");
	_Require(targetBaseline.replace(/\s+/gu, "").includes(compactKey) && authorizationMigration.replace(/\s+/gu, "").includes(compactKey), `fresh and upgraded databases must share silo key ${siloKey}`);
}
_Require(authorizationMigration.includes("'organization-membership-admin-bootstrap:' || principal.\"id\""), "the upgrade projection must use a principal-scoped organization-admin grant manager");
_Require(!authorizationMigration.includes("'organization-membership-admin-bootstrap',"), "the upgrade projection must not retain the shared organization-admin grant manager");
_Require(authorizationMigration.includes("ERRCODE = 'OC717'") && authorizationMigration.includes('HAVING count(principal."id") <> 1'), "membership-derived grants must fail closed when an active membership does not resolve to exactly one Principal");
_RequireBeforeIn(authorizationMigration, "ERRCODE = 'OC717'", "-- Project current Owner/Admin roles", "active membership identity must be validated before administrator grants are projected");
_Require(authorizationMigration.includes("('read', 'organization:read')") && authorizationMigration.includes("('administer', 'organization:administer')"), "the upgrade projection must install both read and administration grants for current organization administrators");
_Require(authorizationMigration.includes("action.\"capability_id\", 'organization', principal.\"silo_id\", 'allow', 0"), "the upgrade projection must match the live organization-admin grant priority");
_Require(authorizationMigration.includes("('persona', 'persona-collection:create', 'persona-collection')"), "active members must receive the Persona creation root during upgrade");
_Require(authorizationMigration.includes("'organization-membership-product-bootstrap:' || principal.\"id\""), "the upgrade projection must use a principal-scoped member-product grant manager");
_Require(!authorizationMigration.includes("'organization-membership-product-bootstrap',"), "the upgrade projection must not retain the shared member-product grant manager");
_Require(authorizationMigration.includes("ERRCODE = 'OC715'"), "the Persona owner projection must fail closed on ambiguous Principal identity");
_Require(authorizationMigration.includes("'persona-creator-access'"), "existing Persona owners must receive the live creator-managed grants");
_Require(!authorizationMigration.includes("ERRCODE = 'OC716'") && !authorizationMigration.includes("'central-approval-"), "the destructive approval cutoff must not validate or seed deleted pending approvals");
_Require(!authorizationMigration.includes("'deferred-tool-approval-assignee'"), "the upgrade must leave approval grant creation to post-cutover runtime admission");
const activeExactGrantIndex = `CREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"(
    "silo_id", "subject_kind", COALESCE("subject_group_id", ''), COALESCE("subject_principal_id", ''),
    "boundary_kind", COALESCE("boundary_group_id", ''), COALESCE("boundary_principal_id", ''), "boundary_coverage",
    "catalog_id", "catalog_revision", "capability_id", "resource_kind", COALESCE("resource_id", ''), "effect", "priority", COALESCE("manager_id", '')
) WHERE "revoked_at" IS NULL;`;
for (const [source, label] of [[authorizationMigration, "upgrade"], [targetBaseline, "fresh baseline"]])
{
	_Require(_NormalizedSql(source).includes(_NormalizedSql(activeExactGrantIndex)), `${label} must fence only active exact authorization grants`);
}
const providerProjectionStart = authorizationMigration.indexOf("-- Give each active Owner and Admin exact Read and Use authority over every retained silo-global");
const providerProjectionEnd = authorizationMigration.indexOf("-- Translate the legacy MCP-use grant", providerProjectionStart);
_Require(providerProjectionStart >= 0 && providerProjectionEnd > providerProjectionStart, "the retained provider-resource projection must have exact review boundaries");
const providerProjection = authorizationMigration.slice(providerProjectionStart, providerProjectionEnd);
_Require((providerProjection.match(/'provider-resource-0-10-cutover:' \|\| principal\."id"/gu) ?? []).length === 2, "provider and model cutover grants must use the dedicated principal-scoped manager");
_Require(providerProjection.includes("('read', 'provider-connection:read')") && providerProjection.includes("('use', 'provider-connection:use')"), "retained provider connections must grant exact Read and Use actions");
_Require(providerProjection.includes("('read', 'model-definition:read')") && providerProjection.includes("('use', 'model-definition:use')"), "retained model definitions must grant exact Read and Use actions");
_Require(providerProjection.includes("action.\"capability_id\", 'provider-connection', credential.\"id\"") && providerProjection.includes("action.\"capability_id\", 'model-definition', definition.\"id\""), "retained provider grants must bind canonical exact resource ids");
_Require((providerProjection.match(/"scope" = 'global'/gu) ?? []).length === 2 && (providerProjection.match(/"cluster_tenant" IS NULL/gu) ?? []).length === 2, "retained provider grants must project only silo-global resources");
_Require(!providerProjection.includes("provider-connection:discover") && !providerProjection.includes("model-definition:discover") && !providerProjection.includes("'*'"), "retained provider grants must not project Discover or broad resource coordinates");
const targetAuthorizationCatalogue = _ProductAuthorizationCatalogue(targetBaseline);
const migratedAuthorizationCatalogue = _ProductAuthorizationCatalogue(authorizationMigration);
_Require(JSON.stringify(migratedAuthorizationCatalogue) === JSON.stringify(targetAuthorizationCatalogue), "fresh and upgraded databases must install the exact same product-authorization catalogue");
const authorizationDigest = `sha256:${createHash("sha256").update(_CanonicalJson(targetAuthorizationCatalogue.payload)).digest("hex")}`;
_Require(authorizationDigest === targetAuthorizationCatalogue.digest, "product-authorization catalogue digest must bind its canonical payload");
_Require(!migration.includes("pg_advisory"), "the 0.10.0 migration must not restore retired migration preflights");
_Require(!migration.includes("LOCK TABLE"), "the 0.10.0 migration must not restore write fencing");
for (const statement of [
	'DROP TABLE IF EXISTS "run_outbox_events";',
	'DELETE FROM "agent_revision_integration_assignments";',
	'DELETE FROM "integration_custody_references";',
	'DELETE FROM "integrations";',
])
{
	_Require(migration.includes(statement), `approved hard cutoff is missing: ${statement}`);
}

_Require(!targetBaseline.includes("run_outbox_events"), "clean target must remove the run outbox table and authority");
_Require(!targetBaseline.includes("RunOutboxEventKind"), "clean target must remove the run outbox enum");
_Require(authorizationMigration.includes('DROP TABLE IF EXISTS "memory_outbox_events";'), "central cutover must tolerate and remove the optional generic memory outbox table");
_Require(authorizationMigration.includes('DROP TYPE IF EXISTS "MemoryOutboxEventKind";'), "central cutover must tolerate and remove the optional generic memory outbox enum");
_Require(!targetBaseline.includes("memory_outbox_events"), "clean target must remove the generic memory outbox table");
_Require(!targetBaseline.includes("MemoryOutboxEventKind"), "clean target must remove the generic memory outbox enum");
_Require(_NormalizedSql(_MigrationFunction("enforce_agent_run_authority_update")) === _NormalizedSql(_TargetFunction("enforce_agent_run_authority_update").replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")), "the workflow cutover must install the target AgentRun authority function");

for (const retiredMcpbTable of ["mcpb_validation_claims", "mcpb_validations"])
{
	_Require(migration.includes(`IF to_regclass('${retiredMcpbTable}') IS NOT NULL THEN`), `the live 0.9.2 upgrade must tolerate absent ${retiredMcpbTable}`);
	_Require(migration.includes(`EXECUTE 'DELETE FROM "${retiredMcpbTable}";'`), `the cutover must delete ${retiredMcpbTable} when the released database contains it`);
	_Require(migration.includes(`DROP TABLE IF EXISTS "${retiredMcpbTable}";`), `the cutover must remove ${retiredMcpbTable} when present`);
}
_Require(migration.includes('DROP TYPE IF EXISTS "McpbValidationState";'), "the live 0.9.2 upgrade must tolerate an absent MCPB state type");

for (const eraProbeColumn of [
	'"registration_key_digest" TEXT',
	'"registration_digest" TEXT',
	'"era_probe_status" "McpEraProbeStatus" NOT NULL DEFAULT \'not-required\'',
	'"era_protocol_version" TEXT',
	'"era_probe_evidence_digest" TEXT',
	'"era_probe_failure_code" TEXT',
	'"era_probe_attempts" INTEGER NOT NULL DEFAULT 0',
	'"era_probed_at" TIMESTAMP(3)',
])
{
	_Require(migration.includes(`ADD COLUMN IF NOT EXISTS ${eraProbeColumn}`), `the live 0.9.2 upgrade must carry the missing remote era-probe column ${eraProbeColumn}`);
}
_Require(migration.includes('CREATE TYPE "McpEraProbeStatus" AS ENUM'), "the live 0.9.2 upgrade must carry the missing remote era-probe state type");
_Require(migration.includes('CREATE TABLE IF NOT EXISTS "mcp_registration_claims"'), "the live 0.9.2 upgrade must carry the remote registration claim table");
_Require(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_silo_id_registration_key_digest_key"'), "the live 0.9.2 upgrade must carry the remote registration idempotency index");
_RequireBefore('ADD COLUMN IF NOT EXISTS "era_probe_status"', 'ADD CONSTRAINT "mcp_servers_era_probe_evidence_check"', "the remote era-probe schema must exist before its authority constraint");
_RequireBefore('CREATE TABLE IF NOT EXISTS "mcp_registration_claims"', 'ADD CONSTRAINT "mcp_registration_claims_identity_check"', "the remote registration claim table must exist before its authority constraint");
_Require(migration.includes("WHEN btrim(\"era_protocol_version\") <> '' THEN 'unsupported_mcp_protocol_version'"), "the cutover must preserve rejected unsupported-protocol evidence under its 0.10 failure code");
_Require(migration.includes("WHEN \"era_probe_failure_code\" = 'invalid_response' THEN 'not_mcp_server'"), "the cutover must preserve rejected non-MCP evidence under its 0.10 failure code");
_RequireBefore('UPDATE "mcp_servers"\n   SET "era_probe_failure_code"', 'ADD CONSTRAINT "mcp_servers_era_probe_evidence_check"', "released era-probe evidence must be mapped before the stricter 0.10 authority constraint");

_Require(!targetBaseline.includes('SkillWorkload'), "clean target must remove the retired skill workload types");
_Require(!targetBaseline.includes('skill_workload'), "clean target must remove the retired skill workload tables and authority");
_Require(migration.includes('DROP TABLE IF EXISTS "run_outbox_events";'), "the rebuilt cutover must delete the retired run outbox table");
_Require(!migration.includes('CREATE TYPE "RunOutboxEventKind_new"'), "the rebuilt cutover must not recreate a run-outbox enum");
_RequireBefore('DELETE FROM "integrations";', 'DROP TABLE "integrations";', "retired integration data must be deleted before its table is removed");
_RequireBefore('SET "state" = \'cancelled\'', 'SET "state" = \'terminal_failed\'', "active artifact output leases must be cancelled before old jobs become terminal");
_RequireBefore('SET "state" = \'terminal_failed\'', 'RENAME COLUMN "attempt" TO "delivery_count"', "pre-workflow artifact jobs must stop before the new delivery lifecycle is installed");
_RequireBefore("SELECT absurd.create_queue('agent-runs')", 'INSERT INTO "agent_run_workflow_tasks"', "the AgentRun queue must exist before admitted runs are carried forward");
_Require(migration.includes("WHERE run.\"state\" IN ('accepted', 'queued')"), "every safe unstarted AgentRun must receive a workflow task");
_Require(migration.includes("array_to_json(ARRAY['agent-runs.execute/v1', candidate.\"task_key\"])::TEXT"), "backfilled Absurd tasks must use the adapter's exact scoped idempotency key");
_Require(migration.includes("'inputUndefined', FALSE"), "backfilled Absurd tasks must preserve the adapter envelope");

_Require(migration.includes('RENAME COLUMN "attempt" TO "delivery_count"'), "artifact attempts must carry forward as workflow delivery count");
_Require(!migration.includes('DROP COLUMN "attempt"'), "artifact attempt history must not be discarded");
_Require(migration.includes("'pre_0_10_workflow_cutover'"), "retired in-flight artifact jobs must record the hard-cutoff reason");
_Require(migration.includes('ADD COLUMN     "mcp_tools" JSONB NOT NULL DEFAULT \'[]\'::jsonb'), "existing run snapshots must receive an empty MCP tool list");
_RequireBefore('ADD COLUMN     "mcp_tools" JSONB NOT NULL DEFAULT \'[]\'::jsonb', 'ALTER COLUMN "mcp_tools" DROP DEFAULT', "run snapshot rows must be backfilled before the temporary default is removed");

for (const retiredTable of ["agent_revision_integration_assignments", "integration_custody_references", "integrations", "mcpb_validation_claims", "mcpb_validations"])
{
	_Require(migration.includes(`DROP TABLE "${retiredTable}";`) || migration.includes(`DROP TABLE IF EXISTS "${retiredTable}";`), `retired table ${retiredTable} must be removed`);
	_Require(!migration.includes(`CREATE TABLE "${retiredTable}"`), `retired table ${retiredTable} must not be recreated`);
}
for (const replacementTable of ["agent_revision_mcp_tool_assignments", "oci_image_validations", "mcp_server_revisions", "mcp_runtime_executions", "skill_authoring_validations", "agent_run_workflow_tasks"])
{
	_Require(migration.includes(`CREATE TABLE "${replacementTable}"`), `replacement table ${replacementTable} must be installed`);
}

for (const marker of [
	'CREATE VIEW "mcp_runtime_clock" AS',
	'CREATE VIEW "mcp_runtime_claim_candidates" AS SELECT * FROM "select_mcp_runtime_claim_candidate"();',
	'CREATE VIEW "mcp_runtime_release_claim_candidates" AS SELECT * FROM "select_mcp_runtime_release_claim_candidate"();',
	'FOR UPDATE OF execution SKIP LOCKED',
	'CREATE TRIGGER "mcp_runtime_executions_authority"',
	'CREATE TRIGGER "mcp_server_revisions_runtime_completion"',
	'ADD CONSTRAINT "mcp_runtime_executions_identity_check"',
	'McpRuntimeExecution controller claim requires an expired prior fence and a bounded lease proposal',
	'McpRuntimeExecution release claim requires an expired prior fence and a bounded lease proposal',
	'McpRuntimeExecution companion claim requires its registered Pod and bounded lease proposal',
])
{
	_Require(migration.includes(marker), `0.10.0 cutover must install MCP runtime database authority: ${marker}`);
	_Require(targetBaseline.includes(marker), `fresh target must install MCP runtime database authority: ${marker}`);
}
for (const name of [
	"select_mcp_runtime_claim_candidate",
	"select_mcp_runtime_release_claim_candidate",
	"enforce_mcp_runtime_execution_authority",
	"enforce_mcp_server_revision_runtime_completion",
])
{
	_Require(_NormalizedSql(_MigrationFunction(name)) === _NormalizedSql(_TargetFunction(name)), `fresh and upgraded databases must install the exact MCP runtime function ${name}`);
}

for (const queue of ["control-plane", "artifact-preprocessing", "skill-authoring", "agent-runs"])
{
	_Require(targetBaseline.includes(`SELECT absurd.create_queue('${queue}');`), `clean target must install the ${queue} workflow queue`);
}
for (const table of ["conversation_assets", "conversation_asset_output_tickets"])
{
	const foreignKeys = targetBaseline.split("\n").filter(function _IsRunEventKey(line)
	{
		return line.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT `)
			&& line.includes('FOREIGN KEY ("conversation_id", "run_id", "run_attempt", "run_event_sequence") REFERENCES "conversation_run_events"("conversation_id", "run_id", "attempt", "sequence")');
	});
	_Require(foreignKeys.length === 1, `${table} must own exactly one run-event foreign key`);
}

for (const name of [
	"enforce_personal_configuration_change_lifecycle",
	"enforce_artifact_preprocess_job_lifecycle",
	"enforce_artifact_preprocess_output_lease_finalization",
])
{
	const replacement = _TargetFunction(name).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
	_Require(migration.includes(replacement), `forward migration must carry exact target function ${name}`);
}
for (const name of [
	"enforce_artifact_preprocess_claim_completeness",
	"enforce_skill_authoring_validation",
	"enforce_skill_authoring_validation_workload_claim",
	"enforce_skill_authoring_validation_bootstrap",
	"enforce_skill_authoring_validation_completion",
])
{
	_Require(migration.includes(_TargetFunction(name)), `forward migration must install exact target function ${name}`);
}

for (const retiredFunction of [
	"select_skill_workload_claim_candidate",
	"enforce_skill_workload_bootstrap",
	"enforce_skill_workload_authority",
	"cancel_ineligible_skill_workloads",
])
{
	_Require(!migration.includes(`CREATE FUNCTION "${retiredFunction}"`) && !migration.includes(`CREATE OR REPLACE FUNCTION "${retiredFunction}"`), `rebuilt cutover must not reinstall retired function ${retiredFunction}`);
}

console.log("0.9.2-to-0.10.0 Prisma migration contract: PASS");
