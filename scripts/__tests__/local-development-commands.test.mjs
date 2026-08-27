import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createApplicationCommands, createApplicationEnvironment, createLiteLLMRunCommand, createPostgresRunCommand } from "../local-development/commands.mjs";
import { createLocalDevelopmentConfiguration } from "../local-development/configuration.mjs";
import { createDevelopmentSeedCommand } from "../local-development/development-seed-command.mjs";
import { parseLocalDevelopmentArguments } from "../local-development/profiles.mjs";

const _MEMBERSHIP_KEYS = {
	controllerTokenPath: "/tmp/local/controller.token",
	privateKeyPath: "/tmp/local/private.pem",
	publicKeyPath: "/tmp/local/public.pem",
	runtimeLaunchSecretPath: "/tmp/local/runtime-launch.secret"
};
const _PROFILE_CONTRACT = JSON.parse(fs.readFileSync(new URL("../../libs/models/local-development/main/profile-contract.json", import.meta.url), "utf8"));

function _configuration(argumentsList)
{
	return createLocalDevelopmentConfiguration(parseLocalDevelopmentArguments(argumentsList), "/repo", {});
}

test("PostgreSQL uses a named PostgreSQL 17 container and keeps secrets out of arguments", function _postgresCommand()
{
	const specification = createPostgresRunCommand(_configuration([]), { postgresPassword: "postgres-secret" });

	assert.equal(specification.command, "docker");
	assert.equal(specification.arguments.at(-1), "postgres@sha256:e38411452a464af89e5adadb8d223bf53b898d47d6ef918b2d58c08707350449");
	assert.ok(specification.arguments.includes("opencrane-local-postgres"));
	assert.ok(specification.arguments.includes("type=volume,source=opencrane-local-postgres-data,target=/var/lib/postgresql/data"));
	assert.ok(!specification.arguments.includes("postgres-secret"));
	assert.equal(specification.environment.POSTGRES_PASSWORD, "postgres-secret");
});

test("Alternative A runs local LiteLLM without exposing either secret in arguments", function _localLiteLLMCommand()
{
	const configuration = _configuration(["--profile", "agent"]);
	configuration.liteLLMConfigPath = "/tmp/opencrane-local-litellm/anthropic.yaml";
	const secrets = {
		postgresPassword: "postgres-secret",
		providerKey: "provider-secret",
		liteLLMMasterKey: "master-secret"
	};
	const specification = createLiteLLMRunCommand(configuration, secrets);

	assert.ok(specification.arguments.includes("ghcr.io/berriai/litellm-non_root@sha256:39718a9cc9138c99ec812bcde24896411cf54502967a36b19897c539b796fdc7"));
	assert.ok(specification.arguments.includes("type=bind,source=/tmp/opencrane-local-litellm/anthropic.yaml,target=/app/opencrane-local.yaml,readonly"));
	assert.ok(specification.arguments.includes("opencrane-local-development"));
	assert.ok(!specification.arguments.includes("provider-secret"));
	assert.ok(!specification.arguments.includes("master-secret"));
	assert.ok(!specification.arguments.includes("postgres-secret"));
	assert.equal(specification.environment.OPENCRANE_LOCAL_PROVIDER_KEY, "provider-secret");
	assert.equal(specification.environment.LITELLM_MASTER_KEY, "master-secret");
	assert.equal(specification.environment.DATABASE_URL, "postgresql://opencrane:postgres-secret@opencrane-local-postgres:5432/litellm");
});

test("core launches the watched backend and internal development-live UI only", function _coreCommands()
{
	const configuration = _configuration([]);
	const environment = createApplicationEnvironment(configuration, { postgresPassword: "postgres-secret" }, _MEMBERSHIP_KEYS);
	const commands = createApplicationCommands(configuration, environment);

	assert.deepEqual(commands.map(function _names(command) { return command.name; }), ["server", "opencrane-ui"]);
	assert.deepEqual(commands[0].arguments, ["run", "dev:tier2", "-w", "@opencrane/server"]);
	assert.deepEqual(commands[1].arguments, ["nx", "run", "opencrane-ui:serve-browser:development-live", "--port", "4200", "--output-style=stream"]);
	assert.equal(commands[1].environment.NX_NATIVE_COMMAND_RUNNER, "false");
	assert.equal(environment.OPENCRANE_DEVELOPMENT_PROFILE, "core");
});

test("agent adds its local controller and defaults to Alternative A", function _agentCommands()
{
	const configuration = _configuration(["--profile", "agent"]);
	const environment = createApplicationEnvironment(configuration, {
		postgresPassword: "postgres-secret",
		providerKey: "provider-secret",
		liteLLMMasterKey: "master-secret"
	}, _MEMBERSHIP_KEYS);
	const commands = createApplicationCommands(configuration, environment);

	assert.deepEqual(commands.map(function _names(command) { return command.name; }), ["server", "agent-controller", "opencrane-ui"]);
	assert.deepEqual(commands[1].arguments, ["nx", "run", "agent-controller:dev-tier2", "--output-style=stream"]);
	assert.equal(environment.OPENCRANE_DEVELOPMENT_PROFILE, "agent-local");
	assert.equal(environment.LITELLM_ENDPOINT, "http://127.0.0.1:4000");
	assert.equal(environment.OPENCRANE_INITIAL_MODEL_API_KEY, undefined);
	assert.equal(commands[1].environment.OPENCRANE_DEVELOPMENT_PROFILE, "agent-local");
	assert.equal(environment.OPENCRANE_INTERNAL_URL, "http://127.0.0.1:8081");
	assert.equal(environment.OPENCRANE_CONTROLLER_TOKEN_PATH, "/tmp/local/controller.token");
	assert.equal(environment.OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH, "/tmp/local/runtime-launch.secret");
	assert.equal(environment.OPENCRANE_LOCAL_RUNTIME_PYTHON, "/repo/apps/agent-runtime/.venv/bin/python");
	const runtimeProfiles = JSON.parse(environment.AGENT_CONTROLLER_PROFILES_JSON);
	assert.equal(runtimeProfiles["personal-default"].litellmBaseUrl, "http://litellm.local-development-server.svc.cluster.local:4000");
	assert.deepEqual({
		serverNamespace: runtimeProfiles["personal-default"].serverNamespace,
		personal: {
			namespace: runtimeProfiles["personal-default"].namespace,
			identityProfile: runtimeProfiles["personal-default"].identityProfile,
			serviceAccountName: runtimeProfiles["personal-default"].serviceAccountName
		},
		managed: {
			namespace: runtimeProfiles["managed-default"].namespace,
			identityProfile: runtimeProfiles["managed-default"].identityProfile,
			serviceAccountName: runtimeProfiles["managed-default"].serviceAccountName
		}
	}, _PROFILE_CONTRACT.runtimeIdentities);
	assert.equal(commands[1].environment.LITELLM_ENDPOINT, "http://127.0.0.1:4000");
	assert.equal(commands[1].environment.NX_NATIVE_COMMAND_RUNNER, "false");
	assert.equal(commands[1].environment.NX_TUI, "false");
	assert.equal(runtimeProfiles["managed-default"].serverNamespace, _PROFILE_CONTRACT.runtimeIdentities.serverNamespace);
	assert.equal(commands[1].environment.LITELLM_MASTER_KEY, undefined);
	assert.equal(commands[1].environment.OPENCRANE_INITIAL_MODEL_API_KEY, undefined);
	assert.deepEqual(Object.keys(commands[0].environment).sort(), [
		"DATABASE_URL",
		"INTERNAL_PORT",
		"LITELLM_ENDPOINT",
		"LITELLM_MASTER_KEY",
		"OPENCRANE_CONTROLLER_TOKEN_PATH",
		"OPENCRANE_DEVELOPMENT_ENTRYPOINT",
		"OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH",
		"OPENCRANE_DEVELOPMENT_PROFILE",
		"OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH",
		"PORT"
	].sort());
	assert.equal(commands[0].environment.OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH, undefined);
	assert.equal(commands[0].environment.OPENCRANE_INTERNAL_URL, undefined);
	assert.equal(commands[0].environment.OPENCRANE_REPOSITORY_ROOT, undefined);
	assert.equal(commands[0].environment.AGENT_CONTROLLER_PROFILES_JSON, undefined);
	assert.equal(commands[1].environment.DATABASE_URL, undefined);
	assert.equal(commands[1].environment.OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH, undefined);
	const seed = createDevelopmentSeedCommand(environment);
	assert.deepEqual(Object.keys(seed.environment).sort(), [
		"DATABASE_URL",
		"OPENCRANE_DEVELOPMENT_MEMBERSHIP_PRIVATE_KEY_PATH",
		"OPENCRANE_DEVELOPMENT_MEMBERSHIP_PUBLIC_KEY_PATH"
	].sort());
	assert.equal(seed.environment.DATABASE_URL.includes("postgres-secret"), true);
	assert.equal(seed.environment.LITELLM_MASTER_KEY, undefined);
	assert.equal(seed.environment.OPENCRANE_CONTROLLER_TOKEN_PATH, undefined);
	assert.equal(seed.environment.OPENCRANE_RUNTIME_LAUNCH_SECRET_PATH, undefined);
});

test("Alternative B uses only its explicit remote endpoint and admin key", function _remoteEnvironment()
{
	const configuration = _configuration([
		"--profile",
		"agent",
		"--alternative",
		"remote-llm",
		"--remote-litellm-endpoint",
		"https://litellm.example.test",
		"--remote-litellm-master-key-file",
		"/secure/remote.key"
	]);
	const environment = createApplicationEnvironment(configuration, {
		postgresPassword: "postgres-secret",
		liteLLMMasterKey: "remote-admin-secret"
	}, _MEMBERSHIP_KEYS);

	assert.equal(createLiteLLMRunCommand(configuration, {}), undefined);
	assert.equal(environment.LITELLM_ENDPOINT, "https://litellm.example.test");
	assert.equal(environment.LITELLM_MASTER_KEY, "remote-admin-secret");
	assert.equal(environment.OPENCRANE_INITIAL_MODEL_API_KEY, undefined);
});

test("Alternative C provides no LiteLLM or provider credential variables", function _simulatedEnvironment()
{
	const configuration = _configuration(["--profile", "agent", "--alternative", "simulated-llm"]);
	const environment = createApplicationEnvironment(configuration, { postgresPassword: "postgres-secret" }, _MEMBERSHIP_KEYS);

	assert.equal(createLiteLLMRunCommand(configuration, {}), undefined);
	assert.equal(environment.OPENCRANE_DEVELOPMENT_PROFILE, "agent-simulated");
	assert.equal(environment.LITELLM_ENDPOINT, undefined);
	assert.equal(environment.LITELLM_MASTER_KEY, undefined);
	assert.equal(environment.OPENCRANE_INITIAL_MODEL_PROVIDER, undefined);
	assert.equal(environment.OPENCRANE_INITIAL_MODEL_API_KEY, undefined);
});
