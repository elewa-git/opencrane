import assert from "node:assert/strict";
import test from "node:test";

import { waitForLocalLiteLLM } from "../model-gateway.mjs";

test("local LiteLLM readiness proves authenticated model access and key storage before continuing", async function _Waits()
{
	const calls = [];
	let keyAttempts = 0;
	const configuration = { abortSignal: new AbortController().signal, liteLLMPort: 4_000 };
	const secrets = { liteLLMMasterAuthorizationHeaderPath: "/private/session/litellm-header" };
	async function _Delay()
	{
		calls.push("delay");
	}

	async function _Run(command, argumentsList)
	{
		calls.push({ command, argumentsList });
		const keyList = argumentsList.at(-1).endsWith("/key/list");
		if (keyList)
			keyAttempts += 1;

		return { status: keyList && keyAttempts === 1 ? 22 : 0 };
	}

	await waitForLocalLiteLLM(configuration, secrets, {
		delay: _Delay,
		runCommand: _Run,
	});
	const commands = calls.filter((call) => typeof call === "object");
	assert.equal(commands.length, 4);
	assert.equal(calls[2], "delay");
	assert.equal(commands[0].command, "curl");
	assert.equal(commands[0].argumentsList.includes("@/private/session/litellm-header"), true);
	assert.equal(commands[0].argumentsList.join(" ").includes("Bearer"), false);
	assert.equal(commands[0].argumentsList.at(-1), "http://127.0.0.1:4000/v1/models");
	assert.equal(commands[1].argumentsList.at(-1), "http://127.0.0.1:4000/key/list");
	assert.equal(commands[3].argumentsList.at(-1), "http://127.0.0.1:4000/key/list");
});

test("Codespaces allows slow LiteLLM startup and reports the safe container state", async function _CodespacesTimeout()
{
	let delays = 0;
	let requests = 0;
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
		if (command === "docker")
		{
			assert.deepEqual(argumentsList, [
				"inspect",
				"--format",
				"status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}",
				"tier2-litellm",
			]);
			return { status: 0, stdout: "status=exited exit=1 error=\n" };
		}

		requests += 1;
		return { status: 22 };
	}

	await assert.rejects(waitForLocalLiteLLM(configuration, secrets, {
		delay: _Delay,
		runCommand: _Run,
	}), /within 120 seconds \(status=exited exit=1 error=\)/u);
	assert.equal(requests, 480);
	assert.equal(delays, 480);
});
