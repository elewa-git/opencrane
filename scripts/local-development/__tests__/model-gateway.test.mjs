import assert from "node:assert/strict";
import test from "node:test";

import { waitForLocalLiteLLM } from "../model-gateway.mjs";

test("local LiteLLM readiness proves authenticated model access before continuing", async function _Waits()
{
	const calls = [];
	const configuration = { abortSignal: new AbortController().signal, liteLLMPort: 4_000 };
	const secrets = { liteLLMMasterAuthorizationHeaderPath: "/private/session/litellm-header" };
	await waitForLocalLiteLLM(configuration, secrets, {
		delay: async function _Delay() { calls.push("delay"); },
		runCommand: async function _Run(command, argumentsList)
		{
			calls.push({ command, argumentsList });
			return { status: calls.filter(function _Command(call) { return typeof call === "object"; }).length === 1 ? 22 : 0 };
		}
	});
	const commands = calls.filter(function _Command(call) { return typeof call === "object"; });
	assert.equal(commands.length, 2);
	assert.equal(calls[1], "delay");
	assert.equal(commands[0].command, "curl");
	assert.equal(commands[0].argumentsList.includes("@/private/session/litellm-header"), true);
	assert.equal(commands[0].argumentsList.join(" ").includes("Bearer"), false);
	assert.equal(commands[0].argumentsList.at(-1), "http://127.0.0.1:4000/v1/models");
});
