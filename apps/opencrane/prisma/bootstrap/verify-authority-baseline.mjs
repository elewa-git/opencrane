import { readFileSync } from "node:fs";

const _BASELINE = new URL("./target-baseline.sql", import.meta.url);
const _MINIMUM_FUNCTIONS = 75;
const _MINIMUM_TRIGGERS = 80;
// Five legacy foreign keys are intentionally removed with Grant/McpServerGrant, leaving 199.
const _MINIMUM_CONSTRAINTS = 199;
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
}

_Verify();
