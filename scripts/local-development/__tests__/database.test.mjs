import assert from "node:assert/strict";
import test from "node:test";

import { waitForPostgres } from "../database.mjs";

const configuration = { postgresContainerName: "postgres", emulateAmd64: true };

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
	assert.equal(commands.at(-1)[0], "logs");
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
