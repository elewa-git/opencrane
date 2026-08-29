import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prismaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledgerRoot = join(prismaRoot, "prisma-migrations");
const baseline = readFileSync(join(ledgerRoot, "20260826000000_0_9_3_baseline/migration.sql"), "utf8");
const migration = readFileSync(join(ledgerRoot, "20260827000000_0_10_0_workflow_cutover/migration.sql"), "utf8");
const sqlWorkloadRetirement = readFileSync(join(ledgerRoot, "20260829000000_retire_sql_workload_control_plane/migration.sql"), "utf8");
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

const ledgerDirectories = readdirSync(ledgerRoot, { withFileTypes: true }).filter(function _IsDirectory(entry) { return entry.isDirectory(); });
_Require(ledgerDirectories.every(function _HasMigrationSql(entry) { return existsSync(join(ledgerRoot, entry.name, "migration.sql")); }), "every Prisma migration directory must contain migration.sql");

const baselineStatements = baseline
	.split("\n")
	.filter(function _IsSql(line) { return line.trim() !== "" && !line.trimStart().startsWith("--"); });
_Require(baselineStatements.length === 0, "the released 0.9.3 Prisma baseline must remain a no-op");
_Require(releasedCutoverChecksum === "6a4256041ba5a78c6e849531c4d9fffea2cad5afef509344c088e566bcfa0004", "the applied 0.10.0 cutover migration must retain its released checksum");

_Require(migration.startsWith("-- OpenCrane 0.9.3 to 0.10.0 workflow and OCI cutover."), "the forward migration must name its exact release boundary");
_Require(migration.match(/^BEGIN;$/gmu)?.length === 1, "the forward migration must open one transaction");
_Require(migration.match(/^COMMIT;$/gmu)?.length === 1, "the forward migration must commit one transaction");
_Require(migration.trimEnd().endsWith("COMMIT;"), "the forward migration must finish with its transaction commit");
_Require(!migration.includes("pg_advisory"), "the 0.10.0 migration must not restore retired migration preflights");
_Require(!migration.includes("LOCK TABLE"), "the 0.10.0 migration must not restore write fencing");
_RequireBefore('DROP TRIGGER IF EXISTS "run_outbox_events_monotonic"', 'DELETE FROM "run_outbox_events"', "the approved hard cutoff must disable the retired outbox deletion guard first");

for (const statement of [
	'DELETE FROM "run_outbox_events" WHERE "kind"::text IN (\'run.attempt_requested\', \'run.workload_release_requested\');',
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
	'DROP TRIGGER IF EXISTS "skill_workloads_authority" ON "skill_workloads";',
	'DROP TRIGGER IF EXISTS "skill_workload_bootstraps_authority" ON "skill_workload_bootstraps";',
	'DROP TRIGGER IF EXISTS "cancel_ineligible_skill_workloads_on_revision" ON "skill_revisions";',
	'DROP TRIGGER IF EXISTS "cancel_ineligible_skill_workloads_on_invocation" ON "tool_invocations";',
	'DROP VIEW IF EXISTS "skill_workload_claim_candidates";',
	'DROP VIEW IF EXISTS "skill_workload_release_claim_candidates";',
	'DROP FUNCTION IF EXISTS "select_skill_workload_claim_candidate"();',
	'DROP FUNCTION IF EXISTS "select_skill_workload_release_claim_candidate"();',
	'DROP FUNCTION IF EXISTS "enforce_skill_workload_bootstrap"();',
	'DROP FUNCTION IF EXISTS "enforce_skill_workload_authority"();',
	'DROP FUNCTION IF EXISTS "cancel_ineligible_skill_workloads"();',
	'DELETE FROM "skill_workload_bootstraps";',
	'DELETE FROM "skill_workloads";',
	'DROP TABLE "skill_workload_bootstraps";',
	'DROP TABLE "skill_workloads";',
	'DROP TYPE "SkillWorkloadKind";',
	'DROP TYPE "SkillWorkloadState";',
])
{
	_Require(sqlWorkloadRetirement.includes(statement), `SQL workload retirement is missing: ${statement}`);
}

for (const statement of [
	'DROP TRIGGER IF EXISTS "run_outbox_events_accepted_attempt" ON "run_outbox_events";',
	'DROP TRIGGER IF EXISTS "run_outbox_events_monotonic" ON "run_outbox_events";',
	'DROP FUNCTION IF EXISTS "enforce_accepted_outbox_attempt"();',
	'DROP FUNCTION IF EXISTS "enforce_run_outbox_event_update"();',
	'DELETE FROM "run_outbox_events";',
	'DROP TABLE "run_outbox_events";',
	'DROP TYPE "RunOutboxEventKind";',
])
{
	_Require(sqlWorkloadRetirement.includes(statement), `run outbox retirement is missing: ${statement}`);
}
_RequireBeforeIn(sqlWorkloadRetirement, 'DROP TRIGGER IF EXISTS "run_outbox_events_monotonic"', 'DELETE FROM "run_outbox_events";', "the deletion guard must be removed before run outbox rows are deleted");
_RequireBeforeIn(sqlWorkloadRetirement, 'DELETE FROM "run_outbox_events";', 'DROP TABLE "run_outbox_events";', "run outbox rows must be deleted before their table is removed");
_RequireBeforeIn(sqlWorkloadRetirement, 'DROP TABLE "run_outbox_events";', 'DROP TYPE "RunOutboxEventKind";', "the run outbox table must be removed before its enum");
_Require(!targetBaseline.includes("run_outbox_events"), "clean target must remove the run outbox table and authority");
_Require(!targetBaseline.includes("RunOutboxEventKind"), "clean target must remove the run outbox enum");
const runAuthorityReplacement = _TargetFunction("enforce_agent_run_authority_update").replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
_Require(sqlWorkloadRetirement.includes(runAuthorityReplacement), "SQL workload retirement must carry the exact workflow-era AgentRun authority function");

for (const retiredMcpbTable of ["mcpb_validation_claims", "mcpb_validations"])
{
	_Require(migration.includes(`IF to_regclass('${retiredMcpbTable}') IS NOT NULL THEN`), `the live 0.9.3 upgrade must tolerate absent ${retiredMcpbTable}`);
	_Require(migration.includes(`EXECUTE 'DELETE FROM "${retiredMcpbTable}";'`), `the cutover must delete ${retiredMcpbTable} when the released database contains it`);
	_Require(migration.includes(`DROP TABLE IF EXISTS "${retiredMcpbTable}";`), `the cutover must remove ${retiredMcpbTable} when present`);
}
_Require(migration.includes('DROP TYPE IF EXISTS "McpbValidationState";'), "the live 0.9.3 upgrade must tolerate an absent MCPB state type");

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
	_Require(migration.includes(`ADD COLUMN IF NOT EXISTS ${eraProbeColumn}`), `the live 0.9.3 upgrade must carry the missing remote era-probe column ${eraProbeColumn}`);
}
_Require(migration.includes('CREATE TYPE "McpEraProbeStatus" AS ENUM'), "the live 0.9.3 upgrade must carry the missing remote era-probe state type");
_Require(migration.includes('CREATE TABLE IF NOT EXISTS "mcp_registration_claims"'), "the live 0.9.3 upgrade must carry the remote registration claim table");
_Require(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS "mcp_servers_silo_id_registration_key_digest_key"'), "the live 0.9.3 upgrade must carry the remote registration idempotency index");
_RequireBefore('ADD COLUMN IF NOT EXISTS "era_probe_status"', 'ADD CONSTRAINT "mcp_servers_era_probe_evidence_check"', "the remote era-probe schema must exist before its authority constraint");
_RequireBefore('CREATE TABLE IF NOT EXISTS "mcp_registration_claims"', 'ADD CONSTRAINT "mcp_registration_claims_identity_check"', "the remote registration claim table must exist before its authority constraint");
_Require(migration.includes("WHEN btrim(\"era_protocol_version\") <> '' THEN 'unsupported_mcp_protocol_version'"), "the cutover must preserve rejected unsupported-protocol evidence under its 0.10 failure code");
_Require(migration.includes("WHEN \"era_probe_failure_code\" = 'invalid_response' THEN 'not_mcp_server'"), "the cutover must preserve rejected non-MCP evidence under its 0.10 failure code");
_RequireBefore('UPDATE "mcp_servers"\n   SET "era_probe_failure_code"', 'ADD CONSTRAINT "mcp_servers_era_probe_evidence_check"', "released era-probe evidence must be mapped before the stricter 0.10 authority constraint");

_Require(!targetBaseline.includes('SkillWorkload'), "clean target must remove the retired skill workload types");
_Require(!targetBaseline.includes('skill_workload'), "clean target must remove the retired skill workload tables and authority");
_RequireBefore('DELETE FROM "run_outbox_events"', 'CREATE TYPE "RunOutboxEventKind_new"', "retired run events must be deleted before narrowing their enum");
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

console.log("0.9.3-to-0.10.0 Prisma migration contract: PASS");
