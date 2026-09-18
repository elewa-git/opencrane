import assert from "node:assert/strict";
import test from "node:test";

import { waitForLocalLiteLLM } from "../model-gateway.mjs";

function _RunningState()
{
	return { ExitCode: 0, OOMKilled: false, Running: true, Status: "running" };
}

test("local LiteLLM readiness proves authenticated model access and key storage before continuing", async function _Waits()
{
	const calls = [];
	let keyAttempts = 0;
	const configuration = {
		abortSignal: new AbortController().signal,
		liteLLMContainerName: "tier2-litellm",
		liteLLMPort: 4_000
	};
	const secrets = { liteLLMMasterAuthorizationHeaderPath: "/private/session/litellm-header" };
	async function _Delay()
	{
		calls.push("delay");
	}

	async function _Run(command, argumentsList)
	{
		calls.push({ command, argumentsList });

		if (command === "docker")
			return { status: 0, stdout: `${JSON.stringify(_RunningState())}\n` };

		const keyList = argumentsList.at(-1).endsWith("/key/list");
		if (keyList)
			keyAttempts += 1;

		return { status: keyList && keyAttempts === 1 ? 22 : 0 };
	}

	await waitForLocalLiteLLM(configuration, secrets, {}, {
		delay: _Delay,
		runCommand: _Run,
	});
	const commands = calls.filter((call) => typeof call === "object");
	assert.equal(commands.length, 5);
	assert.equal(calls[3], "delay");
	assert.equal(commands[0].command, "curl");
	assert.equal(commands[0].argumentsList.includes("@/private/session/litellm-header"), true);
	assert.equal(commands[0].argumentsList.join(" ").includes("Bearer"), false);
	assert.equal(commands[0].argumentsList.at(-1), "http://127.0.0.1:4000/v1/models");
	assert.equal(commands[1].argumentsList.at(-1), "http://127.0.0.1:4000/key/list");
	assert.equal(commands[4].argumentsList.at(-1), "http://127.0.0.1:4000/key/list");
});

test("Codespaces reports an exited LiteLLM container immediately with redacted startup logs", async function _CodespacesExit()
{
	let delays = 0;
	let requests = 0;
	const configuration = {
		abortSignal: new AbortController().signal,
		codespaceName: "careful-crane-123",
		liteLLMContainerName: "tier2-litellm",
		liteLLMPort: 4_000,
	};
	const secrets = {
		liteLLMDatabasePassword: "database/secret+value",
		liteLLMMasterAuthorizationHeaderPath: "/private/session/litellm-header",
		liteLLMMasterKey: "master-secret"
	};
	const provider = { providerKey: "provider-secret" };
	async function _Delay()
	{
		delays += 1;
	}

	async function _Run(command, argumentsList)
	{
		if (command === "curl")
		{
			requests += 1;
			return { status: 22 };
		}

		if (argumentsList[0] === "container")
		{
			const state = { ExitCode: 1, OOMKilled: false, Running: false, Status: "exited" };
			return { status: 0, stdout: `${JSON.stringify(state)}\n` };
		}

		assert.deepEqual(argumentsList, ["logs", "--tail", "50", "tier2-litellm"]);
		return {
			status: 0,
			stdout: "Prisma failed with provider-secret and master-secret\n",
			stderr: "DATABASE_URL password=database%2Fsecret%2Bvalue"
		};
	}

	let error;

	try
	{
		await waitForLocalLiteLLM(configuration, secrets, provider, {
			delay: _Delay,
			runCommand: _Run,
		});
	}
	catch (startupError)
	{
		error = startupError;
	}

	assert.ok(error instanceof Error);
	assert.match(error.message, /exited before model routing.+status=exited exit=1/u);
	assert.match(error.message, /Prisma failed with \[redacted\] and \[redacted\]/u);
	assert.match(error.message, /password=\[redacted\]/u);
	assert.equal(error.message.includes("provider-secret"), false);
	assert.equal(error.message.includes("master-secret"), false);
	assert.equal(error.message.includes("database/secret+value"), false);
	assert.equal(error.message.includes("database%2Fsecret%2Bvalue"), false);
	assert.equal(requests, 1);
	assert.equal(delays, 0);
});

test("Codespaces retains its 120-second readiness window while LiteLLM is running", async function _CodespacesTimeout()
{
	let delays = 0;
	let requests = 0;
	let inspections = 0;
	const configuration = {
		abortSignal: new AbortController().signal,
		codespaceName: "careful-crane-123",
		liteLLMContainerName: "tier2-litellm",
		liteLLMPort: 4_000,
	};
	const secrets = { liteLLMMasterAuthorizationHeaderPath: "/private/session/litellm-header" };
	async function _Delay()
	{
		delays += 1;
	}

	async function _Run(command, argumentsList)
	{
		if (command === "curl")
		{
			requests += 1;
			return { status: 22 };
		}

		if (argumentsList[0] === "container")
		{
			inspections += 1;
			return { status: 0, stdout: `${JSON.stringify(_RunningState())}\n` };
		}

		return { status: 0, stdout: "still starting\n", stderr: "" };
	}

	await assert.rejects(waitForLocalLiteLLM(configuration, secrets, {}, {
		delay: _Delay,
		runCommand: _Run,
	}), /within 120 seconds \(status=running exit=0\).+still starting/su);
	assert.equal(requests, 480);
	assert.equal(inspections, 481);
	assert.equal(delays, 480);
});
