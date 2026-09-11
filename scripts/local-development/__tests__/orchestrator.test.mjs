import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareModelCredentials, runLocalDevelopmentSession } from "../orchestrator.mjs";

test("the production credential path enforces remote administrator-key separation", async function _CredentialPlan()
{
	const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencrane-tier2-model-"));
	const keysDirectory = path.join(repositoryRoot, "keys");
	fs.mkdirSync(keysDirectory);
	const localKeyPath = path.join(keysDirectory, ".openai-key");
	const remoteKeyPath = path.join(repositoryRoot, "remote-admin-key");
	fs.writeFileSync(localKeyPath, "local-provider\n", { mode: 0o600 });
	fs.writeFileSync(remoteKeyPath, "remote-administrator\n", { mode: 0o600 });
	try
	{
		const remote = await prepareModelCredentials({ alternative: "remote-llm", remoteLiteLLMMasterKeyFile: remoteKeyPath, repositoryRoot });
		assert.equal(remote.kind, "remote");
		assert.equal(remote.remoteMasterKey, "remote-administrator");
		await assert.rejects(prepareModelCredentials({ alternative: "remote-llm", remoteLiteLLMMasterKeyFile: localKeyPath, repositoryRoot }), /must not reuse/);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { force: true, recursive: true });
	}
});

test("a normal stop removes reverse-owned resources and preserves paired volumes", async function _CleanupOrder()
{
	const events = [];
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	processHost.kill = function _Kill() {};
	const configuration = {
		alternative: "simulated-llm",
		developmentProfile: "agent-simulated",
		kurrentContainerName: "kurrent",
		kurrentImage: "kurrent@sha256:test",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		liteLLMContainerName: "litellm",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		repositoryRoot: "/repo",
		reset: false
	};
	await runLocalDevelopmentSession(configuration, {
		applyTargetBaseline: async function _Baseline() { events.push("baseline"); },
		bootstrapKurrent: async function _Bootstrap() { events.push("bootstrap"); },
		createLocalDevelopmentSecrets: async function _Secrets() { return { browserSessionCredential: "browser-session", directory: "/tmp/session" }; },
		ensureOwnedNetwork: async function _Network() { events.push("network"); },
		ensureOwnedVolume: async function _Volume(name) { events.push(`volume:${name}`); },
		processHost,
		prepareModelCredentials: async function _Credentials() { return { kind: "simulated" }; },
		removeLocalDevelopmentSecrets: function _SecretsCleanup() { events.push("remove:secrets"); },
		removeOwnedDockerResource: async function _Remove(kind, name) { events.push(`remove:${kind}:${name}`); },
		runDevelopmentProcesses: async function _Processes() {},
		runSpecification: async function _Start(specification) { events.push(`start:${specification.arguments[3]}`); },
		validateInputs: async function _Validate() {},
		waitForPostgres: async function _Wait() {}
	});
	assert.equal(events.includes("remove:volume:postgres-volume"), false);
	assert.equal(events.includes("remove:volume:kurrent-volume"), false);
	assert.deepEqual(events.slice(-6), [
		"remove:container:kurrent",
		"remove:container:kurrent-tls-provisioner",
		"remove:volume:kurrent-tls-volume",
		"remove:container:postgres",
		"remove:network:network",
		"remove:secrets",
	]);
});

test("terminal suspend resumes the process group, aborts children, and cleans resources", async function _SuspendCleanup()
{
	const events = [];
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	processHost.kill = function _Kill(processId, signal) { events.push(`signal:${processId}:${signal}`); };
	const configuration = {
		alternative: "simulated-llm",
		developmentProfile: "agent-simulated",
		kurrentContainerName: "kurrent",
		kurrentImage: "kurrent@sha256:test",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		liteLLMContainerName: "litellm",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		repositoryRoot: "/repo",
		reset: false
	};
	await runLocalDevelopmentSession(configuration, {
		applyTargetBaseline: async function _Baseline() {},
		bootstrapKurrent: async function _Bootstrap() {},
		createLocalDevelopmentSecrets: async function _Secrets() { return { browserSessionCredential: "browser-session", directory: "/tmp/session" }; },
		ensureOwnedNetwork: async function _Network() {},
		ensureOwnedVolume: async function _Volume() {},
		processHost,
		prepareModelCredentials: async function _Credentials() { return { kind: "simulated" }; },
		removeLocalDevelopmentSecrets: function _SecretsCleanup() { events.push("remove:secrets"); },
		removeOwnedDockerResource: async function _Remove(kind, name) { events.push(`remove:${kind}:${name}`); },
		runDevelopmentProcesses: async function _Processes(_commands, _root, options)
		{
			processHost.emit("SIGTSTP");
			assert.equal(options.signal.aborted, true);
		},
		runSpecification: async function _Start() {},
		validateInputs: async function _Validate() {},
		waitForPostgres: async function _Wait() {}
	});
	assert.equal(events.includes("signal:0:SIGCONT"), true);
	assert.equal(events.at(-1), "remove:secrets");
});

test("a network acquisition failure removes a resource created before the operation rejected", async function _NetworkAcquisitionCleanup()
{
	const events = [];
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	processHost.kill = function _Kill() {};
	const configuration = {
		developmentProfile: "core",
		kurrentContainerName: "kurrent",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		profile: "core",
		repositoryRoot: "/repo",
		reset: false
	};

	await assert.rejects(runLocalDevelopmentSession(configuration, {
		createLocalDevelopmentSecrets: async function _Secrets() { return { browserSessionCredential: "browser-session", directory: "/tmp/session" }; },
		ensureOwnedNetwork: async function _Network()
		{
			events.push("created:network");
			throw new Error("network inspection interrupted");
		},
		processHost,
		removeLocalDevelopmentSecrets: function _SecretsCleanup() { events.push("remove:secrets"); },
		removeOwnedDockerResource: async function _Remove(kind, name) { events.push(`remove:${kind}:${name}`); },
		validateInputs: async function _Validate() {},
	}), /network inspection interrupted/u);

	assert.deepEqual(events, ["created:network", "remove:network:network", "remove:secrets"]);
});

test("a failed startup reports both its primary error and a cleanup failure", async function _PrimaryAndCleanupFailures()
{
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	processHost.kill = function _Kill() {};
	const configuration = {
		developmentProfile: "core",
		kurrentContainerName: "kurrent",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		profile: "core",
		repositoryRoot: "/repo",
		reset: false
	};

	await assert.rejects(runLocalDevelopmentSession(configuration, {
		createLocalDevelopmentSecrets: async function _Secrets() { return { browserSessionCredential: "browser-session", directory: "/tmp/session" }; },
		ensureOwnedNetwork: async function _Network() { throw new Error("network inspection interrupted"); },
		processHost,
		removeLocalDevelopmentSecrets: function _SecretsCleanup() {},
		removeOwnedDockerResource: async function _Remove() { throw new Error("Docker daemon unavailable during cleanup"); },
		validateInputs: async function _Validate() {},
	}), function _ContainsBothFailures(error)
	{
		assert.equal(error instanceof AggregateError, true);
		assert.match(error.message, /session failed and resource cleanup also failed/u);
		assert.match(error.errors[0].message, /network inspection interrupted/u);
		assert.match(error.errors[1].message, /resource cleanup failed/u);
		return true;
	});
});

test("a TLS-volume acquisition failure removes a volume created before the operation rejected", async function _TlsVolumeAcquisitionCleanup()
{
	const events = [];
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	processHost.kill = function _Kill() {};
	const configuration = {
		developmentProfile: "core",
		kurrentContainerName: "kurrent",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		profile: "core",
		repositoryRoot: "/repo",
		reset: false
	};

	await assert.rejects(runLocalDevelopmentSession(configuration, {
		applyTargetBaseline: async function _Baseline() {},
		createLocalDevelopmentSecrets: async function _Secrets() { return { browserSessionCredential: "browser-session", directory: "/tmp/session" }; },
		ensureOwnedNetwork: async function _Network() {},
		ensureOwnedVolume: async function _Volume(name)
		{
			if (name === configuration.kurrentTlsVolumeName)
			{
				events.push("created:tls-volume");
				throw new Error("TLS volume inspection interrupted");
			}
		},
		processHost,
		removeLocalDevelopmentSecrets: function _SecretsCleanup() { events.push("remove:secrets"); },
		removeOwnedDockerResource: async function _Remove(kind, name) { events.push(`remove:${kind}:${name}`); },
		runSpecification: async function _Start() {},
		validateInputs: async function _Validate() {},
		waitForPostgres: async function _Wait() {},
	}), /TLS volume inspection interrupted/u);

	assert.equal(events.includes("remove:volume:kurrent-tls-volume"), true);
	assert.equal(events.at(-1), "remove:secrets");
});
