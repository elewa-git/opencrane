import assert from "node:assert/strict";
import test from "node:test";

import crypto from "node:crypto";

import { applyTargetBaseline, ensureLocalLiteLLMDatabase, waitForOwnedPostgres } from "../local-development/postgres.mjs";

/** Builds injected database initialization operations and records every SQL file application. */
function _BaselineOperations(queryResults)
{
	const applied = [];
	return {
		applied,
		operations: {
			readFile() { return Buffer.from("reviewed baseline"); },
			queryPostgres() { return queryResults.shift() ?? ""; },
			applySqlFile(_configuration, path, variables) { applied.push({ path, variables }); }
		}
	};
}

test("a PostgreSQL readiness failure stops the exact owned container", async function _readinessCleanup()
{
	const stopped = [];
	const failure = new Error("PostgreSQL did not become ready");

	await assert.rejects(waitForOwnedPostgres(
		{ postgresContainerName: "opencrane-local-postgres" },
		async function _FailReadiness() { throw failure; },
		function _StopContainer(name) { stopped.push(name); }
	), failure);
	assert.deepEqual(stopped, ["opencrane-local-postgres"]);
});

test("Alternative A creates a separate LiteLLM database only when it is absent", function _liteLLMDatabase()
{
	const commands = [];
	const configuration = { postgresContainerName: "opencrane-local-postgres" };
	ensureLocalLiteLLMDatabase(
		configuration,
		function _MissingDatabase() { return ""; },
		function _Capture(command, argumentsList) { commands.push({ command, argumentsList }); }
	);

	assert.deepEqual(commands, [{
		command: "docker",
		argumentsList: [
			"exec",
			"--interactive",
			"opencrane-local-postgres",
			"psql",
			"--username",
			"opencrane",
			"--dbname",
			"opencrane",
			"--set",
			"ON_ERROR_STOP=1",
			"--command",
			"CREATE DATABASE litellm;"
		]
	}]);
	ensureLocalLiteLLMDatabase(configuration, function _ExistingDatabase() { return "1"; }, function _UnexpectedCommand() { throw new Error("database already exists"); });
});

test("an empty database receives the reviewed baseline and digest marker", function _AppliesEmptyDatabase()
{
	const fixture = _BaselineOperations(["f", "f"]);
	const configuration = {
		baselinePath: "/repo/target-baseline.sql",
		seedPath: "/repo/local-state.sql"
	};
	applyTargetBaseline(configuration, fixture.operations);

	const digest = crypto.createHash("sha256").update(Buffer.from("reviewed baseline")).digest("hex");
	assert.deepEqual(fixture.applied, [
		{ path: configuration.baselinePath, variables: undefined },
		{ path: configuration.seedPath, variables: { baseline_sha256: digest } }
	]);
});

test("a matching database initialization replays without applying SQL", function _ReusesMatchingDatabase()
{
	const digest = crypto.createHash("sha256").update(Buffer.from("reviewed baseline")).digest("hex");
	const fixture = _BaselineOperations(["t", digest]);
	applyTargetBaseline({ baselinePath: "/repo/target-baseline.sql", seedPath: "/repo/local-state.sql" }, fixture.operations);
	assert.deepEqual(fixture.applied, []);
});

test("database initialization refuses a changed digest and an untracked schema", function _RefusesUnsafeDatabase()
{
	const mismatch = _BaselineOperations(["t", "different-digest"]);
	assert.throws(
		() => applyTargetBaseline({ baselinePath: "/repo/target-baseline.sql", seedPath: "/repo/local-state.sql" }, mismatch.operations),
		/different target baseline/u
	);

	const untracked = _BaselineOperations(["f", "t"]);
	assert.throws(
		() => applyTargetBaseline({ baselinePath: "/repo/target-baseline.sql", seedPath: "/repo/local-state.sql" }, untracked.operations),
		/untracked application schema/u
	);
});
