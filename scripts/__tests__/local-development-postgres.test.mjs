import assert from "node:assert/strict";
import test from "node:test";

import { ensureLocalLiteLLMDatabase, waitForOwnedPostgres } from "../local-development/postgres.mjs";

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
