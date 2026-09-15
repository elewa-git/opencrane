import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_DEVELOPMENT_ALTERNATIVES, parseLocalDevelopmentArguments } from "../profiles.mjs";

/** Assert that one invalid public argument list fails with the expected contract error. */
function _AssertRejected(argumentsList, expected)
{
	function _Parse()
	{
		parseLocalDevelopmentArguments(argumentsList);
	}

	assert.throws(_Parse, expected);
}

test("core accepts reset without admitting model options", function _CoreProfile()
{
	const parsed = parseLocalDevelopmentArguments([
		"--profile",
		"core",
		"--reset",
	]);

	assert.equal(parsed.profile, "core");
	assert.equal(parsed.reset, true);
	assert.equal(parsed.alternative, undefined);
	_AssertRejected([
		"--profile",
		"core",
		"--alternative",
		"simulated-llm",
	], /Model alternatives apply only/u);
});

test("ARM emulation remains an explicit option for either profile", function _EmulationOption()
{
	const core = parseLocalDevelopmentArguments(["--profile", "core", "--emulate-amd64"]);
	const agent = parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "simulated-llm", "--emulate-amd64"]);
	assert.equal(core.emulateAmd64, true);
	assert.equal(agent.emulateAmd64, true);
});

test("agent defaults to local LiteLLM and accepts its provider coordinates", function _LocalAgent()
{
	const defaults = parseLocalDevelopmentArguments(["--profile", "agent"]);
	const selected = parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"local-llm",
		"--provider",
		"openai",
		"--model",
		"gpt-5.5",
	]);

	assert.equal(defaults.alternative, LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM);
	assert.equal(selected.provider, "openai");
	assert.equal(selected.model, "gpt-5.5");
});

test("agent accepts every explicit model alternative", function _Alternatives()
{
	const cases = [
		{
			alternative: LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM,
			extra: [],
		},
		{
			alternative: LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM,
			extra: [
				"--remote-litellm-endpoint",
				"https://models.example.test",
				"--remote-litellm-master-key-file",
				"/tmp/master-key",
			],
		},
		{
			alternative: LOCAL_DEVELOPMENT_ALTERNATIVES.Simulated,
			extra: [],
		},
	];

	for (const entry of cases)
	{
		const parsed = parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			entry.alternative,
			...entry.extra,
		]);

		assert.equal(parsed.alternative, entry.alternative);
	}
});

test("remote LiteLLM requires a complete pair and normalizes its HTTPS origin", function _RemoteAgent()
{
	const parsed = parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"remote-llm",
		"--remote-litellm-endpoint",
		"https://models.example.test:443",
		"--remote-litellm-master-key-file",
		"/tmp/master-key",
	]);

	assert.equal(parsed.remoteLiteLLMEndpoint, "https://models.example.test");
	_AssertRejected([
		"--profile",
		"agent",
		"--alternative",
		"remote-llm",
		"--remote-litellm-endpoint",
		"https://models.example.test",
	], /requires --remote-litellm-endpoint and --remote-litellm-master-key-file/u);
	_AssertRejected([
		"--profile",
		"agent",
		"--alternative",
		"remote-llm",
		"--remote-litellm-endpoint",
		"http:\/\/models.example.test",
		"--remote-litellm-master-key-file",
		"/tmp/master-key",
	], /must be an HTTPS origin/u);
});

test("model alternatives reject options owned by another alternative", function _AlternativeIsolation()
{
	const rejected = [
		[
			"--profile",
			"agent",
			"--alternative",
			"local-llm",
			"--remote-litellm-endpoint",
			"https://models.example.test",
		],
		[
			"--profile",
			"agent",
			"--alternative",
			"remote-llm",
			"--provider",
			"openai",
		],
		[
			"--profile",
			"agent",
			"--alternative",
			"simulated-llm",
			"--model",
			"gpt-5.5",
		],
	];

	for (const argumentsList of rejected)
	{
		_AssertRejected(argumentsList, /options apply only/u);
	}
});

test("missing values, unknown options, and unsupported categories fail before acquisition", function _InvalidArguments()
{
	_AssertRejected(["--profile"], /--profile requires a value/u);
	_AssertRejected(["--profile", "tier2"], /--profile must be exactly core or agent/u);
	_AssertRejected([
		"--profile",
		"agent",
		"--alternative",
		"unknown",
	], /--alternative must be exactly/u);
	_AssertRejected(["--unknown"], /Unknown local-development option/u);
});

test("help exits argument validation without requiring a profile", function _Help()
{
	const parsed = parseLocalDevelopmentArguments(["--help"]);

	assert.equal(parsed.help, true);
	assert.equal(parsed.profile, undefined);
});
