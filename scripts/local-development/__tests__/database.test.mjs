import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { applyTargetBaseline, waitForPostgres } from "../database.mjs";

const configuration = { postgresContainerName: "postgres", emulateAmd64: true };
const baselinePath = fileURLToPath(new URL("../../../apps/opencrane/prisma/bootstrap/target-baseline.sql", import.meta.url));
const seedPath = fileURLToPath(new URL("../../../apps/opencrane/prisma/development/seed.sql", import.meta.url));

test("a partially initialized cluster gets its missing application database before the clean baseline", async function _MissingApplicationDatabase()
{
	const commands = [];
	async function _Docker(_command, argumentsList, options)
	{
		commands.push({ argumentsList, hasInput: Boolean(options?.input) });

		if (argumentsList.includes("SELECT 1 FROM pg_database WHERE datname = 'opencrane';"))
			return { stdout: "" };

		if (argumentsList.some((argument) => argument.includes("to_regclass")))
			return { stdout: "f\n" };

		return { stdout: "" };
	}

	const localConfiguration = {
		...configuration,
		baselineDigest: "baseline",
		baselinePath,
		seedPath
	};
	const operations = { runCommand: _Docker };
	await applyTargetBaseline(localConfiguration, operations);
	const create = commands.findIndex((entry) => entry.argumentsList.includes("CREATE DATABASE opencrane;"));
	const baseline = commands.findIndex((entry) => entry.hasInput);

	assert.equal(create, 1);
	assert.equal(create < baseline, true);
	const inventoryArguments = commands[0].argumentsList;
	const createArguments = commands[create].argumentsList;
	const baselineArguments = commands[baseline].argumentsList;
	assert.equal(inventoryArguments[inventoryArguments.indexOf("--dbname") + 1], "postgres");
	assert.equal(createArguments[createArguments.indexOf("--dbname") + 1], "postgres");
	assert.equal(baselineArguments[baselineArguments.indexOf("--dbname") + 1], "opencrane");
	assert.equal(commands.some((entry) => entry.argumentsList.some((argument) => argument.includes("DROP DATABASE"))), false);
});

test("an existing application database is not recreated before baseline reuse", async function _ExistingApplicationDatabase()
{
	const commands = [];
	async function _Docker(_command, argumentsList)
	{
		commands.push(argumentsList);

		if (argumentsList.includes("SELECT 1 FROM pg_database WHERE datname = 'opencrane';"))
			return { stdout: "1\n" };

		if (argumentsList.some((argument) => argument.includes("to_regclass('public.opencrane_local_development_state')")))
			return { stdout: "t\n" };

		if (argumentsList.some((argument) => argument.includes("target_baseline_sha256")))
			return { stdout: "baseline\n" };

		return { stdout: "" };
	}

	const localConfiguration = {
		...configuration,
		baselineDigest: "baseline",
		baselinePath,
		seedPath
	};
	const operations = { runCommand: _Docker };
	await applyTargetBaseline(localConfiguration, operations);

	assert.equal(commands.some((argumentsList) => argumentsList.includes("CREATE DATABASE opencrane;")), false);
	assert.equal(commands.at(-1).includes("--dbname"), true);
});

test("PostgreSQL early exit reports its code and logs before session cleanup", async function _EarlyExit()
{
	const commands = [];
	async function _Docker(_command, argumentsList)
	{
		commands.push(argumentsList);

		if (argumentsList[0] === "exec")
		{
			const result = { status: 1, stdout: "", stderr: "" };

			return result;
		}

		if (argumentsList[0] === "container")
		{
			const state = {
				Running: false,
				ExitCode: 1,
				OOMKilled: false
			};

			const stdout = JSON.stringify(state);
			const result = { status: 0, stdout, stderr: "" };

			return result;
		}

		const result = { status: 0, stdout: "", stderr: "FATAL: incompatible runtime" };

		return result;
	}

	await assert.rejects(waitForPostgres(configuration, { runCommand: _Docker }), /exited with code 1[\s\S]*FATAL: incompatible runtime/u);
	assert.equal(commands[0].includes("127.0.0.1"), true);
	assert.equal(commands[0][commands[0].indexOf("--dbname") + 1], "postgres");
	assert.equal(commands.at(-1)[0], "logs");
});

test("socket-only initialization does not satisfy the final TCP readiness check", async function _SocketOnlyInitialization()
{
	let probes = 0;
	async function _Docker(_command, argumentsList)
	{
		if (argumentsList[0] === "exec")
		{
			assert.equal(argumentsList[argumentsList.indexOf("--host") + 1], "127.0.0.1");
			probes += 1;

			return { status: probes === 3 ? 0 : 1 };
		}

		return { status: 0, stdout: JSON.stringify({ Running: true }) };
	}

	async function _Advance() {}

	const operations = {
		runCommand: _Docker,
		sleep: _Advance
	};
	await waitForPostgres(configuration, operations);
	assert.equal(probes, 3);
});

test("running PostgreSQL gets a longer wall-clock window under AMD64 emulation", async function _EmulatedStartup()
{
	let currentTime = 0;
	async function _Docker(_command, argumentsList)
	{
		if (argumentsList[0] === "exec")
			return { status: currentTime >= 40_000 ? 0 : 1 };

		return { status: 0, stdout: JSON.stringify({ Running: true }) };
	}

	async function _Advance()
	{
		currentTime += 1_000;
	}

	/** Supplies the test's simulated wall clock to the readiness waiter. */
	function _Now() { return currentTime; }

	const operations = {
		now: _Now,
		runCommand: _Docker,
		sleep: _Advance
	};

	await waitForPostgres(configuration, operations);
	assert.equal(currentTime, 40_000);
});

test("native PostgreSQL timeout includes startup logs after 30 seconds", async function _NativeTimeout()
{
	let currentTime = 0;
	async function _Docker(_command, argumentsList)
	{
		if (argumentsList[0] === "exec")
			return { status: 1 };

		if (argumentsList[0] === "container")
			return { status: 0, stdout: JSON.stringify({ Running: true }) };

		return { status: 0, stdout: "initializing", stderr: "" };
	}

	async function _Advance()
	{
		currentTime += 10_000;
	}

	/** Supplies the test's simulated wall clock to the readiness waiter. */
	function _Now() { return currentTime; }

	const nativeConfiguration = { ...configuration, emulateAmd64: false };
	const operations = {
		now: _Now,
		runCommand: _Docker,
		sleep: _Advance
	};

	await assert.rejects(waitForPostgres(nativeConfiguration, operations), /within 30 seconds[\s\S]*initializing/u);
});
