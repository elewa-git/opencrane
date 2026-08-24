import assert from "node:assert/strict";
import test from "node:test";

import { runLocalDevelopmentSession } from "../local-development/orchestrator.mjs";

function _Operations(calls, options = {})
{
	return {
		acquireLocalDevelopmentLock() { calls.push("lock"); return { lockPath: "/repo/lock" }; },
		applyTargetBaseline() { calls.push("baseline"); },
		createApplicationCommands() { calls.push("commands"); return ["applications"]; },
		createApplicationEnvironment() { calls.push("environment"); return { DATABASE_URL: "local" }; },
		createDevelopmentSeedCommand() { calls.push("seed-command"); return { command: "seed" }; },
		createDisposableDevelopmentCredentials(includeAgentCredentials) { calls.push(`credentials:${includeAgentCredentials}`); return { directory: "/tmp/credentials" }; },
		ensureLocalLiteLLMDatabase() { calls.push("litellm-database"); },
		loadLocalDevelopmentSecrets() { calls.push("secrets"); return { liteLLMMasterKey: "master-key" }; },
		prepareLocalAgentRuntimeEnvironment() { calls.push("runtime-python"); },
		releaseLocalDevelopmentLock() { calls.push("unlock"); },
		removeDisposableDevelopmentCredentials() { calls.push("remove-credentials"); },
		resetLocalDevelopmentContainers() { calls.push("reset"); },
		async runDevelopmentProcesses() { calls.push("processes"); if (options.processFailure) throw options.processFailure; },
		runLocalCommandSpecification() { calls.push("seed"); },
		async startLocalLiteLLM() { calls.push("start-litellm"); return true; },
		async startLocalPostgres() { calls.push("start-postgres"); return true; },
		stopOwnedContainer(name) { calls.push(`stop:${name}`); },
		async validateLiteLLMModelEndpoint() { calls.push("validate-remote-litellm"); },
		validateLocalDevelopmentTools() { calls.push("validate-tools"); },
		async waitForLiteLLMModelEndpoint() { calls.push("wait-litellm"); },
		writeStatus() { calls.push("status"); }
	};
}

function _Configuration(overrides = {})
{
	return {
		repositoryRoot: "/repo",
		profile: "core",
		alternative: undefined,
		developmentProfile: "core",
		liteLLMContainerName: "opencrane-local-litellm",
		liteLLMPort: 4000,
		postgresContainerName: "opencrane-local-postgres",
		reset: false,
		...overrides
	};
}

test("core starts the database before seeding and always releases owned state", async function _CoreOrder()
{
	const calls = [];
	const failure = new Error("application stopped");

	await assert.rejects(runLocalDevelopmentSession(_Configuration(), _Operations(calls, { processFailure: failure })), failure);
	assert.deepEqual(calls, [
		"lock",
		"validate-tools",
		"secrets",
		"credentials:false",
		"status",
		"start-postgres",
		"baseline",
		"environment",
		"seed-command",
		"seed",
		"commands",
		"processes",
		"stop:opencrane-local-postgres",
		"remove-credentials",
		"unlock"
	]);
});

test("Alternative A prepares and validates LiteLLM after the application database seed", async function _LocalLiteLLMOrder()
{
	const calls = [];

	await runLocalDevelopmentSession(_Configuration({ profile: "agent", alternative: "A", developmentProfile: "agent-local" }), _Operations(calls));
	assert.equal(calls.includes("credentials:true"), true);
	assert.ok(calls.indexOf("runtime-python") < calls.indexOf("secrets"));
	assert.ok(calls.indexOf("seed") < calls.indexOf("litellm-database"));
	assert.ok(calls.indexOf("litellm-database") < calls.indexOf("start-litellm"));
	assert.ok(calls.indexOf("start-litellm") < calls.indexOf("wait-litellm"));
	assert.ok(calls.indexOf("wait-litellm") < calls.indexOf("processes"));
	assert.deepEqual(calls.slice(-4), ["stop:opencrane-local-litellm", "stop:opencrane-local-postgres", "remove-credentials", "unlock"]);
});

test("Alternative B validates the remote endpoint before mutating local containers", async function _RemoteValidationOrder()
{
	const calls = [];

	await runLocalDevelopmentSession(_Configuration({ profile: "agent", alternative: "B", developmentProfile: "agent-remote", remoteLiteLLMEndpoint: "https://litellm.example.test", reset: true }), _Operations(calls));
	assert.ok(calls.indexOf("validate-remote-litellm") < calls.indexOf("reset"));
	assert.ok(calls.indexOf("reset") < calls.indexOf("start-postgres"));
	assert.equal(calls.includes("start-litellm"), false);
});
