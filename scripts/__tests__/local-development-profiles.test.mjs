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
	assert.equal(configuration.postgresPort, 54329);
	assert.equal(configuration.liteLLMPort, 4000);
});

test("agent defaults to Alternative A", function _defaultAgentAlternative()
{
	const parsed = parseLocalDevelopmentArguments(["--profile", "agent"]);
	const configuration = createLocalDevelopmentConfiguration(parsed, "/repo", {});

	assert.equal(configuration.alternative, "A");
	assert.equal(configuration.developmentProfile, "agent-local");
});

test("agent accepts exact Alternatives A, B, and C", function _exactAlternatives()
{
	const local = parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "A"]);
	const remote = parseLocalDevelopmentArguments([
		"--profile",
		"agent",
		"--alternative",
		"B",
		"--remote-litellm-endpoint",
		"https://litellm.example.test/",
		"--remote-litellm-master-key-file",
		"/secure/remote.key"
	]);
	const simulated = parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "C"]);

	assert.equal(local.alternative, "A");
	assert.equal(remote.remoteLiteLLMEndpoint, "https://litellm.example.test");
	assert.equal(simulated.alternative, "C");
	assert.throws(function _lowercaseAlternative() { parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "a"]); }, /exactly A, B, or C/);
});

test("coordinator outputs remain aligned with the cross-process profile contract", function _profileContract()
{
	const configurations = [
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments([]), "/repo", {}),
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "A"]), "/repo", {}),
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "B", "--remote-litellm-endpoint", "https://litellm.example.test", "--remote-litellm-master-key-file", "/secure/remote.key"]), "/repo", {}),
		createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "C"]), "/repo", {})
	];

	assert.deepEqual(configurations.map(configuration => configuration.developmentProfile), _PROFILE_CONTRACT.profiles);
});

test("Alternative B fails closed without an explicit HTTPS endpoint and key file", function _remoteValidation()
{
	assert.throws(function _missingRemoteSettings()
	{
		parseLocalDevelopmentArguments(["--profile", "agent", "--alternative", "B"]);
	}, /requires both/);
	assert.throws(function _insecureEndpoint()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"B",
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
			"B",
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
		parseLocalDevelopmentArguments(["--profile", "core", "--alternative", "A"]);
	}, /only to --profile agent/);
	assert.throws(function _localRemoteEndpoint()
	{
		parseLocalDevelopmentArguments([
			"--profile",
			"agent",
			"--alternative",
			"A",
			"--remote-litellm-endpoint",
			"https://litellm.example.test"
		]);
	}, /only to Alternative B/);
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
});
