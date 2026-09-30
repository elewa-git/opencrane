import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "yaml";

/** Dedicated URL that must never be inferred from the general database connection. */
const _MONTHLY_BUDGET_URL = "postgresql://postgres:postgres@localhost:5432/monthly_budget_qualification";

/** Names one workflow job and whether it must retain the nightly freshness condition. */
const _WORKFLOWS = [
	{ path: ".github/workflows/docker.yml", job: "database", conditional: false },
	{ path: ".github/workflows/nightly.yml", job: "nightly", conditional: true },
];

test("runs monthly budget SQL qualification against a separate explicit database", function _ChecksMonthlyBudgetQualification()
{
	for (const expected of _WORKFLOWS)
	{
		const workflow = parse(readFileSync(fileURLToPath(new URL(`../../${expected.path}`, import.meta.url)), "utf8"));
		const job = workflow.jobs[expected.job];
		const steps = job.steps;
		const baseline = steps.find(step => step.name === "Apply the fresh monthly budget qualification baseline");
		const qualification = steps.find(step => step.name === "Run the monthly budget PostgreSQL qualification");
		assert.ok(baseline, `${expected.path} must create the isolated monthly budget database`);
		assert.ok(qualification, `${expected.path} must run the dedicated monthly budget target`);
		assert.equal(baseline.env.OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL, _MONTHLY_BUDGET_URL, expected.path);
		assert.equal(qualification.env.OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL, _MONTHLY_BUDGET_URL, expected.path);
		assert.notEqual(job.env.DATABASE_URL, _MONTHLY_BUDGET_URL, expected.path);
		assert.equal(job.services.postgres.image, "postgres:17", expected.path);
		assert.ok(job.services.postgres.ports.includes("5432:5432"), `${expected.path} must expose PostgreSQL on localhost`);
		assert.match(baseline.run, /psql "\$DATABASE_URL"[^\n]+CREATE DATABASE monthly_budget_qualification/u, expected.path);
		assert.match(baseline.run, /psql "\$OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL"[^\n]+target-baseline\.sql/u, expected.path);
		assert.equal((baseline.run.match(/--set=ON_ERROR_STOP=1/gu) ?? []).length, 2, expected.path);
		assert.equal(qualification.run, "npx nx run backend-agents-execution-runs:test:monthly-budget:sql --excludeTaskDependencies", expected.path);
		assert.ok(steps.indexOf(baseline) < steps.indexOf(qualification), `${expected.path} must load the baseline before qualification`);
		assert.equal(baseline.if ?? null, expected.conditional ? "steps.fresh.outputs.changed == 'true'" : null, expected.path);
		assert.equal(qualification.if ?? null, expected.conditional ? "steps.fresh.outputs.changed == 'true'" : null, expected.path);
		assert.notEqual(baseline["continue-on-error"], true, expected.path);
		assert.notEqual(qualification["continue-on-error"], true, expected.path);
		assert.doesNotMatch(baseline.env.OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL, /\$\{|DATABASE_URL/u, expected.path);
		assert.doesNotMatch(qualification.env.OPENCRANE_MONTHLY_BUDGET_SQL_DATABASE_URL, /\$\{|DATABASE_URL/u, expected.path);
	}
});
