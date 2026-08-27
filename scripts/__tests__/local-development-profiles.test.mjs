import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createLocalDevelopmentConfiguration } from "../local-development/configuration.mjs";
import { parseLocalDevelopmentArguments } from "../local-development/profiles.mjs";

const _PROFILE_CONTRACT = JSON.parse(fs.readFileSync(new URL("../../libs/models/local-development/main/profile-contract.json", import.meta.url), "utf8"));

test("core is the default local-development profile", function _defaultCore()
{
	const parsed = parseLocalDevelopmentArguments([]);
	const configuration = createLocalDevelopmentConfiguration(parsed, "/repo", {});

	assert.equal(configuration.profile, "core");
	assert.equal(configuration.developmentProfile, "core");
	assert.equal(configuration.publicPort, 8080);
	assert.equal(configuration.internalPort, 8081);
	assert.equal(configuration.uiPort, 4200);
	assert.equal(configuration.postgresPort, 54329);
	assert.equal(configuration.liteLLMPort, 4000);
});

test("agent defaults to Alternative A", function _defaultAgentAlternative()
{
	const parsed = parseLocalDevelopmentArguments(["--profile", "agent"]);
	const configuration = createLocalDevelopmentConfiguration(parsed, "/repo", {});

	assert.equal(configuration.alternative, "local-llm");
	assert.equal(configuration.developmentProfile, "agent-local");
	assert.equal(configuration.provider, undefined);
	assert.equal(configuration.model, undefined);
	assert.equal(configuration.providerKeyPath, undefined);
});

test("Alternative A accepts an exact model for registry validation during setup", function _customModel()
{
	const parsed = parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"local-llm",
		"--model",
		"anthropic/claude-sonnet-4-5-20250929"
	]);
	const configuration = createLocalDevelopmentConfiguration(parsed, "/repo", {});

	assert.equal(configuration.model, "anthropic/claude-sonnet-4-5-20250929");
});

test("Alternative A accepts an exact provider for registry validation during setup", function _CustomProvider()
{
	const parsed = parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"local-llm",
		"--provider",
		"anthropic"
	]);
	const configuration = createLocalDevelopmentConfiguration(parsed, "/repo", {});

	assert.equal(configuration.provider, "anthropic");
	assert.equal(configuration.model, undefined);
});

test("named alternatives can print help without runtime-specific settings", function _AlternativeHelp()
{
	const parsed = parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "remote-llm", "--help"]);

	assert.equal(parsed.help, true);
	assert.equal(parsed.alternative, "remote-llm");
});

test("agent accepts exact descriptive alternatives", function _exactAlternatives()
{
	const local = parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "local-llm"]);
	const remote = parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"remote-llm",
		"--remote-litellm-endpoint",
		"https://litellm.example.test/",
		"--remote-litellm-master-key-file",
		"/secure/remote.key"
	]);
	const simulated = parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "simulated-llm"]);

	assert.equal(local.alternative, "local-llm");
	assert.equal(remote.remoteLiteLLMEndpoint, "https://litellm.example.test");
	assert.equal(simulated.alternative, "simulated-llm");
	assert.throws(function _opaqueAlternative() { parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "A"]); }, /exactly local-llm, remote-llm, or simulated-llm/);
});

test("coordinator outputs remain aligned with the cross-process profile contract", function _profileContract()
{
	const configurations = [
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments([]), "/repo", {}),
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "local-llm"]), "/repo", {}),
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "remote-llm", "--remote-litellm-endpoint", "https://litellm.example.test", "--remote-litellm-master-key-file", "/secure/remote.key"]), "/repo", {}),
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "simulated-llm"]), "/repo", {})
	];

	assert.deepEqual(configurations.map(configuration => configuration.developmentProfile), _PROFILE_CONTRACT.profiles);
});

test("Alternative B fails closed without an explicit HTTPS endpoint and key file", function _remoteValidation()
{
	assert.throws(function _missingRemoteSettings()
	{
		parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "remote-llm"]);
	}, /requires both/);
	assert.throws(function _insecureEndpoint()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"remote-llm",
			"--remote-litellm-endpoint",
			"http://litellm.example.test",
			"--remote-litellm-master-key-file",
			"/secure/remote.key"
		]);
	}, /HTTPS/);
	assert.throws(function _loopbackEndpoint()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"remote-llm",
			"--remote-litellm-endpoint",
			"https://127.0.0.1",
			"--remote-litellm-master-key-file",
			"/secure/remote.key"
		]);
	}, /non-loopback/);
});

test("core and non-remote alternatives reject remote model options", function _rejectUnusedOptions()
{
	assert.throws(function _coreAlternative()
	{
		parseLocalDevelopmentArguments(["--profile", "core", "--alternative", "local-llm"]);
	}, /only to --profile agent/);
	assert.throws(function _localRemoteEndpoint()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"local-llm",
			"--remote-litellm-endpoint",
			"https://litellm.example.test"
		]);
	}, /only to Alternative B/);
});

test("provider and model selection apply only to Alternative A", function _RejectUnusedLocalSelection()
{
	assert.throws(function _coreProvider()
	{
		parseLocalDevelopmentArguments(["--provider", "openai"]);
	}, /only to --profile agent/);
	assert.throws(function _coreModel()
	{
		parseLocalDevelopmentArguments(["--model", "openai/gpt-5.4-nano"]);
	}, /only to --profile agent/);
	assert.throws(function _remoteModel()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"remote-llm",
			"--remote-litellm-endpoint",
			"https://litellm.example.test",
			"--remote-litellm-master-key-file",
			"/secure/remote.key",
			"--model",
			"openai/gpt-5.4-nano"
		]);
	}, /only to Alternative A/);
	assert.throws(function _remoteProvider()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"remote-llm",
			"--remote-litellm-endpoint",
			"https://litellm.example.test",
			"--remote-litellm-master-key-file",
			"/secure/remote.key",
			"--provider",
			"openai"
		]);
	}, /only to Alternative A/);
	assert.throws(function _simulatedModel()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"simulated-llm",
			"--model",
			"openai/gpt-5.4-nano"
		]);
	}, /only to Alternative A/);
});

test("local service ports are validated before orchestration", function _portValidation()
{
	const parsed = parseLocalDevelopmentArguments(["--profile", "agent"]);

	assert.throws(function _privilegedPostgresPort()
	{
		createLocalDevelopmentConfiguration(parsed, "/repo", { OPENCRANE_LOCAL_POSTGRES_PORT: "543" });
	}, /1024 to 65535/);
	assert.throws(function _collidingPorts()
	{
		createLocalDevelopmentConfiguration(parsed, "/repo", {
			OPENCRANE_LOCAL_POSTGRES_PORT: "4000",
			OPENCRANE_LOCAL_LITELLM_PORT: "4000"
		});
	}, /different host ports/);
	assert.throws(function _postgresUsesPublicPort()
	{
		createLocalDevelopmentConfiguration(parsed, "/repo", { OPENCRANE_LOCAL_POSTGRES_PORT: "8080" });
	}, /application host port/);
	assert.throws(function _liteLLMUsesInternalPort()
	{
		createLocalDevelopmentConfiguration(parsed, "/repo", { OPENCRANE_LOCAL_LITELLM_PORT: "8081" });
	}, /application host port/);
	assert.throws(function _postgresUsesUiPort()
	{
		createLocalDevelopmentConfiguration(parsed, "/repo", { OPENCRANE_LOCAL_POSTGRES_PORT: "4200" });
	}, /application host port/);
	assert.throws(function _liteLLMUsesUiPort()
	{
		createLocalDevelopmentConfiguration(parsed, "/repo", { OPENCRANE_LOCAL_LITELLM_PORT: "4200" });
	}, /application host port/);
});
