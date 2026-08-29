import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prismaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ledgerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = readFileSync(join(ledgerRoot, "20260826000000_0_9_3_baseline/migration.sql"), "utf8");
const migration = readFileSync(join(ledgerRoot, "20260827000000_0_10_0_workflow_cutover/migration.sql"), "utf8");
const targetBaseline = readFileSync(join(prismaRoot, "bootstrap/target-baseline.sql"), "utf8");

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

function _TargetFunction(name)
{
	const start = targetBaseline.indexOf(`CREATE FUNCTION "${name}"`);
	const end = targetBaseline.indexOf("$$;", start) + 3;
	_Require(start >= 0 && end > 2, `target function ${name} must exist`);
	return targetBaseline.slice(start, end);
}

function _NormalizedSql(value)
{
	return value.replace(/\s+/gu, " ").trim();
}

const baselineStatements = baseline
	.split("\n")
	.filter(function _IsSql(line) { return line.trim() !== "" && !line.trimStart().startsWith("--"); });
_Require(baselineStatements.length === 0, "the released 0.9.3 Prisma baseline must remain a no-op");

_Require(migration.startsWith("-- OpenCrane 0.9.3 to 0.10.0 workflow and OCI cutover."), "the forward migration must name its exact release boundary");
_Require(migration.match(/^BEGIN;$/gmu)?.length === 1, "the forward migration must open one transaction");
_Require(migration.match(/^COMMIT;$/gmu)?.length === 1, "the forward migration must commit one transaction");
_Require(migration.trimEnd().endsWith("COMMIT;"), "the forward migration must finish with its transaction commit");
_Require(!migration.includes("pg_advisory"), "the 0.10.0 migration must not restore retired migration preflights");
_Require(!migration.includes("LOCK TABLE"), "the 0.10.0 migration must not restore write fencing");
_RequireBefore('DROP TRIGGER IF EXISTS "run_outbox_events_monotonic"', 'DELETE FROM "run_outbox_events"', "the approved hard cutoff must disable the retired outbox deletion guard first");

for (const statement of [
	'DELETE FROM "run_outbox_events" WHERE "kind"::text IN (\'run.attempt_requested\', \'run.workload_release_requested\');',
	'DELETE FROM "skill_workload_bootstraps"',
	'DELETE FROM "skill_workloads" WHERE "kind"::text = \'authoring\';',
	'DELETE FROM "agent_revision_integration_assignments";',
	'DELETE FROM "integration_custody_references";',
	'DELETE FROM "integrations";',
])
{
	_Require(migration.includes(statement), `approved hard cutoff is missing: ${statement}`);
}

for (const retiredMcpbTable of ["mcpb_validation_claims", "mcpb_validations"])
{
	_Require(migration.includes(`IF to_regclass('${retiredMcpbTable}') IS NOT NULL THEN`), `the live 0.9.3 upgrade must tolerate absent ${retiredMcpbTable}`);
	_Require(migration.includes(`EXECUTE 'DELETE FROM "${retiredMcpbTable}";'`), `the cutover must delete ${retiredMcpbTable} when the released database contains it`);
	_Require(migration.includes(`DROP TABLE IF EXISTS "${retiredMcpbTable}";`), `the cutover must remove ${retiredMcpbTable} when present`);
}
_Require(migration.includes('DROP TYPE IF EXISTS "McpbValidationState";'), "the live 0.9.3 upgrade must tolerate an absent MCPB state type");

_Require(!targetBaseline.includes("'authoring'::\"SkillWorkloadKind\""), "clean target must retire the authoring SkillWorkload enum member");
_Require(!targetBaseline.includes('"kind" = \'authoring\''), "clean target must not retain authoring SkillWorkload authority");
_Require(!targetBaseline.includes('skill_workloads_one_authoring_per_revision_key'), "clean target must remove the authoring workload index");
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

for (const name of [
	"select_skill_workload_claim_candidate",
	"enforce_skill_workload_bootstrap",
])
{
	_Require(migration.includes(_TargetFunction(name)), `forward migration must install exact target function ${name}`);
}
for (const name of [
	"enforce_skill_workload_authority",
	"cancel_ineligible_skill_workloads",
])
{
	const replacement = _TargetFunction(name).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
	_Require(_NormalizedSql(migration).includes(_NormalizedSql(replacement)), `forward migration must carry exact target function ${name}`);
}

console.log("0.9.3-to-0.10.0 Prisma migration contract: PASS");
