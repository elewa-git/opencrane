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
const digest = createHash("sha256").update(sql).digest("hex");
const targetDigest = createHash("sha256").update(targetBaseline).digest("hex");

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
requireContract(manifest.targetBaselineSha256 === targetDigest, "migration target digest must match the clean baseline");
requireContract(
	manifest.sourceProtectedBaselineSha256 === "25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d",
	"migration must bind the default-owner protected source baseline",
);
requireContract(
	manifest.executionMode === "automatic-when-legacy-persona-empty-otherwise-manual-data-mapping-required",
	"migration execution mode must retain its conditional data boundary",
);
requireContract(sql.includes("pg_advisory_xact_lock"), "migration must acquire the database migration lock");
requireContract(sql.includes("opencrane_bootstrap\".\"target_baseline"), "migration must verify protected bootstrap provenance");
requireContract(sql.includes(manifest.sourceProtectedBaselineSha256), "SQL must require the manifest-bound protected source digest");
requireContract(sql.includes("opencrane_migrations.schema_history"), "migration must reject ambiguous pre-existing schema history");
requireContract(sql.includes("LOCK TABLE"), "migration must lock persona mutation sources before counting them");
requireContract(sql.includes("ERRCODE = 'OC708'"), "migration must retain the explicit semantic-mapping blocker");
requireContract(sql.includes("IF persona_profiles_count + persona_interviews_count"), "OC708 must be conditional on legacy runtime data");
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
requireContract(sql.includes(targetBaseline.slice(seedStart)), "migration must carry the exact governed target seeds");

console.log("0.7.0-to-0.8.0 migration contract: PASS");
