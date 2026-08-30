import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prismaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerRoot = join(prismaRoot, "prisma-migrations");
const baseline = readFileSync(join(ledgerRoot, "20260826000000_0_9_2_baseline/migration.sql"), "utf8");
const migration = readFileSync(join(ledgerRoot, "20260827000000_0_10_0_workflow_cutover/migration.sql"), "utf8");
const sqlWorkloadRetirement = readFileSync(join(ledgerRoot, "20260829000000_retire_sql_workload_control_plane/migration.sql"), "utf8");
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

function _NormalizedSql(value)
{
	return value.replace(/\s+/gu, " ").trim();
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
_Require(releasedCutoverChecksum === "75bc11951270c082f93af39522f091e7982ecfd000e76beb25bb80d3274f4cea", "the rebuilt untagged 0.10.0 cutover migration must retain its reviewed checksum");

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
_Require(authorizationMigration.includes('DROP TABLE "action_execution_receipts";'), "the central authorization migration must remove the replaced proof-bound receipt table");
_Require(authorizationMigration.includes('DROP FUNCTION "enforce_action_execution_receipt_lifecycle"();'), "the central authorization migration must remove the replaced receipt trigger function");
_Require(authorizationMigration.includes('DROP TYPE "ActionExecutionState";'), "the central authorization migration must remove the replaced receipt state type");
_Require(authorizationMigration.includes('DROP TYPE "ActionReplayMode";'), "the central authorization migration must remove the replaced replay type");
_Require(!targetBaseline.includes('CREATE TABLE "action_execution_receipts"'), "fresh databases must not install the replaced proof-bound receipt table");
_Require(authorizationMigration.includes('CREATE TEMP TABLE "precentral_tool_invocations"'), "the central authorization migration must identify every pre-central ToolInvocation");
_Require(authorizationMigration.includes('SELECT "id"\n  FROM "tool_invocations";'), "the hard cutoff must include terminal and task-owned pre-central ToolInvocation rows");
_Require(!authorizationMigration.includes('"state" NOT IN'), "the pre-1.0 cutoff must not retain terminal ToolInvocation compatibility");
_Require(authorizationMigration.includes("to_regclass('skill_workloads') IS NOT NULL"), "the ToolInvocation cutoff must tolerate a repaired candidate that already lacks legacy SQL workloads");
_Require(authorizationMigration.includes("to_regclass('skill_workload_bootstraps') IS NOT NULL"), "the ToolInvocation cutoff must tolerate a repaired candidate that already lacks legacy SQL workload bootstraps");
for (const dependentDelete of [
	'DELETE FROM "skill_workload_bootstraps"',
	'DELETE FROM "skill_workloads"',
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
_Require(authorizationMigration.includes('CREATE TABLE "run_model_credential_mint_authorizations"'), "the central authorization migration must install the one-use model-key effect admission");
_Require(targetBaseline.includes('CREATE TABLE "run_model_credential_mint_authorizations"'), "fresh databases must install the one-use model-key effect admission");
for (const marker of [
	'CREATE TYPE "ProviderEffectCommandKind" AS ENUM (\'set_byok_key\', \'delete_byok_key\', \'register_model\')',
	'CREATE TYPE "ProviderEffectCommandState" AS ENUM (\'pending\', \'awaiting_material\', \'claimed\', \'succeeded\', \'failed\')',
	'CREATE TYPE "ProviderEffectMaterialRequirement" AS ENUM (\'none\', \'ephemeral_provider_key\')',
	'CREATE TABLE "provider_effect_commands"',
	'CREATE INDEX "provider_effect_commands_state_claim_expires_at_idx"',
	'CREATE INDEX "provider_effect_commands_silo_id_created_at_idx"',
	'CREATE UNIQUE INDEX "provider_effect_commands_kind_resource_id_resource_revision_key"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_identity_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_material_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_claim_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_completion_check"',
	'ALTER TABLE "provider_effect_commands" ADD CONSTRAINT "provider_effect_commands_payload_check"',
])
{
	_Require(authorizationMigration.includes(marker), `the 0.9.2-to-0.10.0 path must install provider effect authority: ${marker}`);
	_Require(targetBaseline.includes(marker), `fresh databases must install provider effect authority: ${marker}`);
}
for (const invariant of [
	'"arguments_digest" ~ \'^sha256:[0-9a-f]{64}$\'',
	'"material_verifier" IS NOT NULL AND "material_verifier" ~ \'^sha256:[0-9a-f]{64}$\'',
	'"state" = \'claimed\' AND "claim_fence" IS NOT NULL',
	'"state" = \'succeeded\' AND "completed_at" IS NOT NULL AND "result" IS NOT NULL',
	'"payload" - ARRAY[\'provider\', \'secretRef\', \'litellmCredentialName\'] = \'{}\'::jsonb',
])
{
	_Require(authorizationMigration.includes(invariant), `the provider effect upgrade is missing authority invariant: ${invariant}`);
	_Require(targetBaseline.includes(invariant), `the fresh provider effect table is missing authority invariant: ${invariant}`);
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
_Require(authorizationMigration.includes("'organization-membership-admin-bootstrap'"), "the upgrade projection must use the live organization-admin grant manager");
_Require(authorizationMigration.includes("('read', 'organization:read')") && authorizationMigration.includes("('administer', 'organization:administer')"), "the upgrade projection must install both read and administration grants for current organization administrators");
_Require(authorizationMigration.includes("action.\"capability_id\", 'organization', principal.\"silo_id\", 'allow', 0"), "the upgrade projection must match the live organization-admin grant priority");
_Require(authorizationMigration.includes("('persona', 'persona-collection:create', 'persona-collection')"), "active members must receive the Persona creation root during upgrade");
_Require(authorizationMigration.includes("ERRCODE = 'OC715'"), "the Persona owner projection must fail closed on ambiguous Principal identity");
_Require(authorizationMigration.includes("'persona-creator-access'"), "existing Persona owners must receive the live creator-managed grants");
_Require(authorizationMigration.includes("ERRCODE = 'OC716'"), "the pending approver projection must fail closed on ambiguous Principal identity");
_Require(authorizationMigration.includes("'deferred-tool-approval-assignee'"), "pending tool approvals must receive the live assignee-managed grants");
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

_Require(sqlWorkloadRetirement.match(/^BEGIN;$/gmu)?.length === 1, "the SQL workload retirement must open one transaction");
_Require(sqlWorkloadRetirement.match(/^COMMIT;$/gmu)?.length === 1, "the SQL workload retirement must commit one transaction");
for (const statement of [
	'DROP TRIGGER IF EXISTS "cancel_ineligible_skill_workloads_on_revision" ON "skill_revisions";',
	'DROP TRIGGER IF EXISTS "cancel_ineligible_skill_workloads_on_invocation" ON "tool_invocations";',
	'DROP VIEW IF EXISTS "skill_workload_claim_candidates";',
	'DROP VIEW IF EXISTS "skill_workload_release_claim_candidates";',
	'DROP FUNCTION IF EXISTS "select_skill_workload_claim_candidate"();',
	'DROP FUNCTION IF EXISTS "select_skill_workload_release_claim_candidate"();',
	'DROP FUNCTION IF EXISTS "enforce_skill_workload_bootstrap"();',
	'DROP FUNCTION IF EXISTS "enforce_skill_workload_authority"();',
	'DROP FUNCTION IF EXISTS "cancel_ineligible_skill_workloads"();',
	'DROP TABLE IF EXISTS "skill_workload_bootstraps";',
	'DROP TABLE IF EXISTS "skill_workloads";',
	'DROP TYPE IF EXISTS "SkillWorkloadKind";',
	'DROP TYPE IF EXISTS "SkillWorkloadState";',
])
{
	_Require(sqlWorkloadRetirement.includes(statement), `SQL workload retirement is missing: ${statement}`);
}

for (const statement of [
	'DROP FUNCTION IF EXISTS "enforce_accepted_outbox_attempt"();',
	'DROP FUNCTION IF EXISTS "enforce_run_outbox_event_update"();',
	'DROP TABLE IF EXISTS "run_outbox_events";',
	'DROP TYPE IF EXISTS "RunOutboxEventKind";',
])
{
	_Require(sqlWorkloadRetirement.includes(statement), `run outbox retirement is missing: ${statement}`);
}
_RequireBeforeIn(sqlWorkloadRetirement, 'DROP TABLE IF EXISTS "run_outbox_events";', 'DROP TYPE IF EXISTS "RunOutboxEventKind";', "the run outbox table must be removed before its enum");
_Require(!sqlWorkloadRetirement.includes('DELETE FROM "run_outbox_events"'), "the idempotent retirement must not query an optional legacy run outbox table");
_Require(!sqlWorkloadRetirement.includes('DELETE FROM "skill_workloads"'), "the idempotent retirement must not query an optional legacy skill workload table");
_Require(!targetBaseline.includes("run_outbox_events"), "clean target must remove the run outbox table and authority");
_Require(!targetBaseline.includes("RunOutboxEventKind"), "clean target must remove the run outbox enum");
_Require(authorizationMigration.includes('DROP TABLE IF EXISTS "memory_outbox_events";'), "central cutover must tolerate and remove the optional generic memory outbox table");
_Require(authorizationMigration.includes('DROP TYPE IF EXISTS "MemoryOutboxEventKind";'), "central cutover must tolerate and remove the optional generic memory outbox enum");
_Require(!targetBaseline.includes("memory_outbox_events"), "clean target must remove the generic memory outbox table");
_Require(!targetBaseline.includes("MemoryOutboxEventKind"), "clean target must remove the generic memory outbox enum");
const runAuthorityReplacement = _TargetFunction("enforce_agent_run_authority_update").replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
_Require(sqlWorkloadRetirement.includes(runAuthorityReplacement), "SQL workload retirement must carry the exact workflow-era AgentRun authority function");

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
			&& line.includes('FOREIGN KEY ("conversation_id", "run_id", "run_event_sequence") REFERENCES "conversation_run_events"');
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
