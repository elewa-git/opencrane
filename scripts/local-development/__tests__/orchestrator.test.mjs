import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareModelCredentials, runLocalDevelopmentSession, validateDockerArchitecture } from "../orchestrator.mjs";
import { acquireLocalDevelopmentSessionLock } from "../session-lock.mjs";

/** Sequence that keeps each session-lock fixture independent inside this test process. */
let _sessionLockSequence = 0;

/** Returns a unique lock path for one orchestrator test. */
function _SessionLockPath()
{
	_sessionLockSequence += 1;

	return path.join(os.tmpdir(), `opencrane-tier2-orchestrator-${process.pid}-${_sessionLockSequence}.lock`);
}

test("ARM Docker requires opt-in while AMD64 Codespaces remain native", function _DockerArchitecture()
{
	assert.equal(validateDockerArchitecture("x86_64\n", false), false);
	assert.equal(validateDockerArchitecture("aarch64\n", true), true);
	assert.throws(function _ArmWithoutEmulation()
	{
		validateDockerArchitecture("aarch64", false);
	}, /--emulate-amd64/u);
	assert.throws(function _UnknownArchitecture()
	{
		validateDockerArchitecture("s390x", true);
	}, /AMD64 or ARM64 Docker daemon/u);
});

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
		const localEnvironment = { OPENAI_TIER2_PROVIDER_API_KEY: "codespaces-value-must-not-win" };
		const localConfiguration = {
			alternative: "local-llm",
			provider: "openai",
			repositoryRoot,
		};
		const local = await prepareModelCredentials(localConfiguration, localEnvironment);
		assert.equal(local.kind, "local");
		assert.equal(local.credentialSource, "owner-only-file");
		assert.equal(local.providerKey, "local-provider");
		assert.equal(localEnvironment.OPENAI_TIER2_PROVIDER_API_KEY, "codespaces-value-must-not-win");

		const codespacesEnvironment = {
			OPENAI_TIER2_PROVIDER_API_KEY: "  codespaces-provider  ",
			ANTHROPIC_TIER2_PROVIDER_API_KEY: "unused-provider",
			OPENCRANE_TIER2_DEFAULT_PROVIDER: "openai",
		};
		const codespacesConfiguration = {
			alternative: "local-llm",
			codespaceName: "careful-crane-123",
			defaultProvider: "openai",
			repositoryRoot,
		};
		const codespaces = await prepareModelCredentials(codespacesConfiguration, codespacesEnvironment);
		assert.equal(codespaces.kind, "local");
		assert.equal(codespaces.credentialSource, "codespaces-environment");
		assert.equal(codespaces.providerKey, "codespaces-provider");
		assert.equal(codespaces.selection.provider.name, "openai");
		assert.equal("OPENAI_TIER2_PROVIDER_API_KEY" in codespacesEnvironment, false);
		assert.equal("ANTHROPIC_TIER2_PROVIDER_API_KEY" in codespacesEnvironment, false);
		assert.equal(codespacesEnvironment.OPENCRANE_TIER2_DEFAULT_PROVIDER, "openai");

		const emptyCodespacesEnvironment = { OPENAI_TIER2_PROVIDER_API_KEY: "  " };
		await assert.rejects(prepareModelCredentials(codespacesConfiguration, emptyCodespacesEnvironment), /requires the OPENAI_TIER2_PROVIDER_API_KEY/u);
		await assert.rejects(prepareModelCredentials(codespacesConfiguration, {}), /requires the OPENAI_TIER2_PROVIDER_API_KEY/u);

		const remote = await prepareModelCredentials({
			alternative: "remote-llm",
			remoteLiteLLMMasterKeyFile: remoteKeyPath,
			repositoryRoot,
		});
		assert.equal(remote.kind, "remote");
		assert.equal(remote.remoteMasterKey, "remote-administrator");
		await assert.rejects(prepareModelCredentials({
			alternative: "remote-llm",
			remoteLiteLLMMasterKeyFile: localKeyPath,
			repositoryRoot,
		}), /must not reuse/);
	}
	finally
	{
		fs.rmSync(repositoryRoot, { force: true, recursive: true });
	}
});

test("a normal run prints only the safe browser URL and removes reverse-owned resources", async function _CleanupOrder()
{
	const events = [];
	let terminalOutput = "";
	const stdoutWrite = process.stdout.write;
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	function _CaptureStdout(chunk, encodingOrCallback, callback)
	{
		terminalOutput += String(chunk);

		if (typeof encodingOrCallback === "function")
		{
			encodingOrCallback();
		}
		else if (callback)
		{
			callback();
		}

		return true;
	}

	function _Kill() {}

	processHost.kill = _Kill;
	const configuration = {
		alternative: "simulated-llm",
		browserOrigin: "http://local-development.localhost:4200",
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
		postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
		repositoryRoot: "/repo",
		reset: false,
		sessionLockPath: _SessionLockPath()
	};
	async function _Baseline()
	{
		events.push("baseline");
	}

	async function _Bootstrap()
	{
		events.push("bootstrap");
	}

	async function _Secrets()
	{
		return { browserSessionCredential: "credential-that-must-not-be-printed", directory: "/tmp/session" };
	}

	async function _Network()
	{
		events.push("network");
	}

	async function _Volume(name)
	{
		events.push(`volume:${name}`);
	}

	async function _Credentials()
	{
		events.push("credentials");
		return { kind: "simulated" };
	}

	function _SecretsCleanup()
	{
		events.push("remove:secrets");
	}

	async function _Remove(kind, name)
	{
		events.push(`remove:${kind}:${name}`);
	}

	async function _Processes() {}

	async function _Start(specification)
	{
		events.push(`start:${specification.arguments[3]}`);
	}

	async function _Validate()
	{
		events.push("validate");
	}

	async function _Wait() {}

	process.stdout.write = _CaptureStdout;
	try
	{
		await runLocalDevelopmentSession(configuration, {
			applyTargetBaseline: _Baseline,
			bootstrapKurrent: _Bootstrap,
			createLocalDevelopmentSecrets: _Secrets,
			ensureOwnedNetwork: _Network,
			ensureOwnedVolume: _Volume,
			processHost,
			prepareModelCredentials: _Credentials,
			removeLocalDevelopmentSecrets: _SecretsCleanup,
			removeOwnedDockerResource: _Remove,
			runDevelopmentProcesses: _Processes,
			runSpecification: _Start,
			validateInputs: _Validate,
			waitForPostgres: _Wait,
		});
	}
	finally
	{
		process.stdout.write = stdoutWrite;
	}

	assert.equal(events.includes("remove:volume:postgres-volume"), false);
	assert.equal(events.includes("remove:volume:kurrent-volume"), false);
	assert.equal(events.includes("remove:container:litellm"), true);
	assert.equal(events.indexOf("credentials") < events.indexOf("validate"), true);
	assert.equal(events.indexOf("remove:container:postgres") < events.indexOf("start:postgres-volume-provisioner"), true);
	assert.equal(events.indexOf("start:postgres-volume-provisioner") < events.indexOf("start:postgres"), true);
	assert.deepEqual(events.slice(-7), [
		"remove:container:kurrent",
		"remove:container:kurrent-tls-provisioner",
		"remove:volume:kurrent-tls-volume",
		"remove:container:postgres",
		"remove:container:postgres-volume-provisioner",
		"remove:network:network",
		"remove:secrets",
	]);
	const expectedOutput = [
		"Starting Tier 2 agent-simulated",
		"Tier 2 browser: http://local-development.localhost:4200/",
		"Select \"Open current Tier 2 session\" when the page loads.",
		"Tier 2 stopped. Close the browser tab from this launch before restarting it.",
		"",
	].join("\n");
	assert.equal(terminalOutput, expectedOutput);
	assert.doesNotMatch(terminalOutput, /credential-that-must-not-be-printed/u);
	assert.doesNotMatch(terminalOutput, /development-session=/u);
});

test("a second command warns without touching the active session", async function _ConcurrentSession()
{
	const lockPath = _SessionLockPath();
	const owner = acquireLocalDevelopmentSessionLock(lockPath);
	const processHost = new EventEmitter();
	const warnings = [];
	let validated = false;
	processHost.platform = "darwin";
	function _Kill() {}

	processHost.kill = _Kill;
	function _WriteWarning(message)
	{
		warnings.push(message);
	}

	async function _Validate()
	{
		validated = true;
	}

	try
	{
		assert.equal(owner.acquired, true);
		await runLocalDevelopmentSession({ sessionLockPath: lockPath }, {
			processHost,
			validateInputs: _Validate,
			writeWarning: _WriteWarning,
		});
		assert.equal(fs.existsSync(lockPath), true);
	}
	finally
	{
		owner.release();
	}

	assert.equal(validated, false);
	assert.deepEqual(warnings, [`Tier 2 is already running for this worktree (process ${process.pid}). Use the existing terminal, or stop that command before starting another.\n`]);
});

test("terminal suspend resumes the process group, aborts children, and cleans resources", async function _SuspendCleanup()
{
	const events = [];
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	function _Kill(processId, signal)
	{
		events.push(`signal:${processId}:${signal}`);
	}

	processHost.kill = _Kill;
	const configuration = {
		alternative: "simulated-llm",
		browserOrigin: "http://local-development.localhost:4200",
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
		postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
		repositoryRoot: "/repo",
		reset: false,
		sessionLockPath: _SessionLockPath()
	};
	async function _Baseline() {}

	async function _Bootstrap() {}

	async function _Secrets()
	{
		return { browserSessionCredential: "browser-session", directory: "/tmp/session" };
	}

	async function _Network() {}

	async function _Volume() {}

	async function _Credentials()
	{
		return { kind: "simulated" };
	}

	function _SecretsCleanup()
	{
		events.push("remove:secrets");
	}

	async function _Remove(kind, name)
	{
		events.push(`remove:${kind}:${name}`);
	}

	async function _Processes(_commands, _root, options)
	{
		processHost.emit("SIGTSTP");
		assert.equal(options.signal.aborted, true);
	}

	async function _Start() {}

	async function _Validate() {}

	async function _Wait() {}

	await runLocalDevelopmentSession(configuration, {
		applyTargetBaseline: _Baseline,
		bootstrapKurrent: _Bootstrap,
		createLocalDevelopmentSecrets: _Secrets,
		ensureOwnedNetwork: _Network,
		ensureOwnedVolume: _Volume,
		processHost,
		prepareModelCredentials: _Credentials,
		removeLocalDevelopmentSecrets: _SecretsCleanup,
		removeOwnedDockerResource: _Remove,
		runDevelopmentProcesses: _Processes,
		runSpecification: _Start,
		validateInputs: _Validate,
		waitForPostgres: _Wait,
	});
	assert.equal(events.includes("signal:0:SIGCONT"), true);
	assert.equal(events.at(-1), "remove:secrets");
});

test("a failed PostgreSQL permission helper cleans its container without resetting data", async function _PostgresHelperFailure()
{
	const events = [];
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	function _Kill() {}

	processHost.kill = _Kill;
	const configuration = {
		baselineDigest: "baseline",
		developmentProfile: "core",
		kurrentVolumeName: "kurrent-volume",
		networkName: "network",
		postgresImage: "postgres@sha256:test",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
		profile: "core",
		repositoryIdentity: "repository",
		repositoryRoot: "/repo",
		reset: false,
		sessionLockPath: _SessionLockPath(),
		worktreeIdentity: "worktree"
	};
	async function _Secrets()
	{
		return { browserSessionCredential: "browser-session", directory: "/tmp/session" };
	}

	async function _Network()
	{
		events.push("created:network");
	}

	async function _Volume(name)
	{
		events.push(`retained:volume:${name}`);
	}

	function _SecretsCleanup()
	{
		events.push("remove:secrets");
	}

	async function _Remove(kind, name)
	{
		events.push(`remove:${kind}:${name}`);
	}

	async function _Start(specification)
	{
		assert.equal(specification.arguments.includes(configuration.postgresVolumeProvisionerContainerName), true);
		throw new Error("permission helper could not chown the owned volume");
	}

	async function _Validate() {}

	const operations = {
		createLocalDevelopmentSecrets: _Secrets,
		ensureOwnedNetwork: _Network,
		ensureOwnedVolume: _Volume,
		processHost,
		removeLocalDevelopmentSecrets: _SecretsCleanup,
		removeOwnedDockerResource: _Remove,
		runSpecification: _Start,
		validateInputs: _Validate
	};

	await assert.rejects(runLocalDevelopmentSession(configuration, operations), /permission helper could not chown/u);
	assert.equal(events.includes("remove:volume:postgres-volume"), false);
	assert.equal(events.filter((event) => event === "remove:container:postgres-volume-provisioner").length, 2);
	assert.deepEqual(events.slice(-3), [
		"remove:container:postgres-volume-provisioner",
		"remove:network:network",
		"remove:secrets"
	]);
});

test("a network acquisition failure removes a resource created before the operation rejected", async function _NetworkAcquisitionCleanup()
{
	const events = [];
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	function _Kill() {}

	processHost.kill = _Kill;
	const configuration = {
		developmentProfile: "core",
		kurrentContainerName: "kurrent",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
		profile: "core",
		repositoryRoot: "/repo",
		reset: false,
		sessionLockPath: _SessionLockPath()
	};
	async function _Secrets()
	{
		return { browserSessionCredential: "browser-session", directory: "/tmp/session" };
	}

	async function _Network()
	{
		events.push("created:network");
		throw new Error("network inspection interrupted");
	}

	function _SecretsCleanup()
	{
		events.push("remove:secrets");
	}

	async function _Remove(kind, name)
	{
		events.push(`remove:${kind}:${name}`);
	}

	async function _Validate() {}

	await assert.rejects(runLocalDevelopmentSession(configuration, {
		createLocalDevelopmentSecrets: _Secrets,
		ensureOwnedNetwork: _Network,
		processHost,
		removeLocalDevelopmentSecrets: _SecretsCleanup,
		removeOwnedDockerResource: _Remove,
		validateInputs: _Validate,
	}), /network inspection interrupted/u);

	assert.deepEqual(events, [
		"created:network",
		"remove:network:network",
		"remove:secrets",
	]);
});

test("a failed startup reports both its primary error and a cleanup failure", async function _PrimaryAndCleanupFailures()
{
	const processHost = new EventEmitter();
	processHost.platform = "darwin";
	function _Kill() {}

	processHost.kill = _Kill;
	const configuration = {
		developmentProfile: "core",
		kurrentContainerName: "kurrent",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
		profile: "core",
		repositoryRoot: "/repo",
		reset: false,
		sessionLockPath: _SessionLockPath()
	};
	async function _Secrets()
	{
		return { browserSessionCredential: "browser-session", directory: "/tmp/session" };
	}

	async function _Network()
	{
		throw new Error("network inspection interrupted");
	}

	function _SecretsCleanup() {}

	async function _Remove()
	{
		throw new Error("Docker daemon unavailable during cleanup");
	}

	async function _Validate() {}

	await assert.rejects(runLocalDevelopmentSession(configuration, {
		createLocalDevelopmentSecrets: _Secrets,
		ensureOwnedNetwork: _Network,
		processHost,
		removeLocalDevelopmentSecrets: _SecretsCleanup,
		removeOwnedDockerResource: _Remove,
		validateInputs: _Validate,
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
	function _Kill() {}

	processHost.kill = _Kill;
	const configuration = {
		developmentProfile: "core",
		kurrentContainerName: "kurrent",
		kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
		kurrentTlsVolumeName: "kurrent-tls-volume",
		kurrentVolumeName: "kurrent-volume",
		networkName: "network",
		postgresContainerName: "postgres",
		postgresVolumeName: "postgres-volume",
		postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
		profile: "core",
		repositoryRoot: "/repo",
		reset: false,
		sessionLockPath: _SessionLockPath()
	};
	async function _Baseline() {}

	async function _Secrets()
	{
		return { browserSessionCredential: "browser-session", directory: "/tmp/session" };
	}

	async function _Network() {}

	async function _Volume(name)
	{
		if (name === configuration.kurrentTlsVolumeName)
		{
			events.push("created:tls-volume");
			throw new Error("TLS volume inspection interrupted");
		}
	}

	function _SecretsCleanup()
	{
		events.push("remove:secrets");
	}

	async function _Remove(kind, name)
	{
		events.push(`remove:${kind}:${name}`);
	}

	async function _Start() {}

	async function _Validate() {}

	async function _Wait() {}

	await assert.rejects(runLocalDevelopmentSession(configuration, {
		applyTargetBaseline: _Baseline,
		createLocalDevelopmentSecrets: _Secrets,
		ensureOwnedNetwork: _Network,
		ensureOwnedVolume: _Volume,
		processHost,
		removeLocalDevelopmentSecrets: _SecretsCleanup,
		removeOwnedDockerResource: _Remove,
		runSpecification: _Start,
		validateInputs: _Validate,
		waitForPostgres: _Wait,
	}), /TLS volume inspection interrupted/u);

	assert.equal(events.includes("remove:volume:kurrent-tls-volume"), true);
	assert.equal(events.at(-1), "remove:secrets");
});
