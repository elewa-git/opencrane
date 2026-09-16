import fs from "node:fs";

import { prepareLocalLiteLLMConfiguration } from "../../apps/_infra/litellm/local-development/config-generation.mjs";
import { createModelCredentialPlan, readOwnerOnlyCredentialFile } from "../../apps/_infra/litellm/local-development/provider-selection.mjs";
import { runLocalCommand } from "./command-runner.mjs";
import { createApplicationCommands, createKurrentCommand, createKurrentTlsVolumeCommand, createLiteLLMCommand, createPostgresCommand, createPostgresVolumeProvisionerCommand } from "./commands.mjs";
import { applyTargetBaseline, bootstrapKurrent, waitForPostgres } from "./database.mjs";
import { ensureOwnedNetwork, ensureOwnedVolume, removeOwnedDockerResource, resetOwnedPersistentState } from "./docker-resources.mjs";
import { runDevelopmentProcesses } from "./process-supervisor.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";
import { waitForLocalLiteLLM } from "./model-gateway.mjs";
import { createAcquisitionLedger } from "./resource-ledger.mjs";
import { createLocalDevelopmentSecrets, removeLocalDevelopmentSecrets, removePersistentLocalDevelopmentSecrets } from "./secrets.mjs";
import { acquireLocalDevelopmentSessionLock } from "./session-lock.mjs";

/** Writes a non-failing launcher warning for a command that does not acquire resources. */
function _writeWarning(message)
{
	process.stderr.write(message);
}

/** Writes one launcher status message. */
function _writeStatus(message)
{
	process.stdout.write(message);
}

/** Runs one command plan through the shared command runner. */
async function _runSpecification(specification, configuration)
{
	await runLocalCommand(specification.command, specification.arguments, {
		environment: specification.environment,
		signal: configuration.abortSignal
	});
}

/** Require a daemon that can run the pinned operands natively or by explicit AMD64 emulation. */
export function validateDockerArchitecture(architectureValue, emulateAmd64)
{
	const architecture = architectureValue.trim().toLowerCase();
	const nativeAmd64 = ["amd64", "x86_64"].includes(architecture);
	const nativeArm64 = ["arm64", "aarch64"].includes(architecture);

	if (!nativeAmd64 && !nativeArm64)
		throw new Error(`Tier 2 requires an AMD64 or ARM64 Docker daemon; found ${architecture || "unknown"}`);

	if (nativeArm64 && !emulateAmd64)
		throw new Error("The pinned PostgreSQL and KurrentDB images require AMD64. Use an AMD64 Codespace or rerun with --emulate-amd64 on an ARM Docker daemon; emulation can be slow or fail.");

	return nativeArm64;
}

/** Validates required host commands and immutable repository inputs before acquiring resources. */
async function _validateInputs(configuration)
{
	const commandChecks = [
		["docker", ["version"]],
		["npm", ["--version"]],
		["npx", ["--version"]],
		["openssl", ["version"]],
		["curl", ["--version"]],
		["jq", ["--version"]],
		["base64", []]
	];

	for (const [command, argumentsList] of commandChecks)
	{
		await runLocalCommand(command, argumentsList, { signal: configuration.abortSignal });
	}

	const docker = await runLocalCommand("docker", ["info", "--format", "{{.Architecture}}"], { signal: configuration.abortSignal });
	const nativeArm64 = validateDockerArchitecture(docker.stdout, configuration.emulateAmd64);

	if (nativeArm64)
		process.stdout.write("Tier 2 is emulating AMD64 PostgreSQL and KurrentDB on an ARM Docker daemon; startup can be slow or fail.\n");

	const requiredPaths = [
		configuration.baselinePath,
		configuration.seedPath,
		configuration.kurrentBootstrapPath
	];

	for (const requiredPath of requiredPaths)
	{
		if (!fs.existsSync(requiredPath))
		{
			throw new Error(`Required Tier 2 input is missing: ${requiredPath}`);
		}
	}
}

/** Resolves the selected model credential path before any local resource is acquired. */
export async function prepareModelCredentials(configuration)
{
	const plan = createModelCredentialPlan(configuration);

	if (plan.kind === "simulated")
	{
		return plan;
	}

	if (plan.kind === "remote")
	{
		return { ...plan, remoteMasterKey: readOwnerOnlyCredentialFile(plan.remoteMasterKeyPath) };
	}

	return { ...plan, providerKey: readOwnerOnlyCredentialFile(plan.selection.providerKeyPath) };
}

/**
 * Runs one Tier 2 profile and attempts each registered cleanup in reverse order.
 *
 * Cleanup is registered before acquisitions that can create a Docker resource and then reject, so
 * a failed startup still removes partial state. A cleanup failure is reported alongside the startup
 * failure instead of replacing it.
 */
export async function runLocalDevelopmentSession(configuration, operationOverrides = {})
{
	const operations = {
		acquireSessionLock: acquireLocalDevelopmentSessionLock,
		applyTargetBaseline,
		bootstrapKurrent,
		createLocalDevelopmentSecrets,
		ensureOwnedNetwork,
		ensureOwnedVolume,
		prepareModelCredentials,
		removeLocalDevelopmentSecrets,
		removePersistentLocalDevelopmentSecrets,
		removeOwnedDockerResource,
		resetOwnedPersistentState,
		runDevelopmentProcesses,
		runSpecification: _runSpecification,
		validateInputs: _validateInputs,
		waitForLocalLiteLLM,
		waitForPostgres,
		writeStatus: _writeStatus,
		writeWarning: _writeWarning,
		processHost: process,
		...operationOverrides
	};
	const shutdown = new AbortController();
	const ledger = createAcquisitionLedger();
	const sessionConfiguration = { ...configuration, abortSignal: shutdown.signal };
	let browserSessionReady = false;
	function _stop() { shutdown.abort(new Error("Tier 2 local development stopped")); }
	function _resumeAndStop()
	{
		if (operations.processHost.platform !== "win32")
		{
			operations.processHost.kill(0, "SIGCONT");
		}

		_stop();
	}

	operations.processHost.once("SIGINT", _stop);
	operations.processHost.once("SIGTERM", _stop);
	operations.processHost.once("SIGHUP", _stop);
	operations.processHost.once("SIGTSTP", _resumeAndStop);
	let primaryFailure;

	try
	{
		const sessionLock = operations.acquireSessionLock(sessionConfiguration.sessionLockPath);

		if (!sessionLock.acquired)
		{
			const owner = sessionLock.ownerPid ? ` (process ${sessionLock.ownerPid})` : "";
			operations.writeWarning(`Tier 2 is already running for this worktree${owner}. Use the existing terminal, or stop that command before starting another.\n`);
			return;
		}

		ledger.acquire("session lock", async function _releaseSessionLock() { sessionLock.release(); });
		await operations.validateInputs(sessionConfiguration);
		const modelCredentials = sessionConfiguration.profile === "core"
			? undefined
			: await operations.prepareModelCredentials(sessionConfiguration);

		if (sessionConfiguration.reset)
		{
			await operations.resetOwnedPersistentState(sessionConfiguration, { signal: shutdown.signal });
			operations.removePersistentLocalDevelopmentSecrets(sessionConfiguration);
		}

		const secrets = await operations.createLocalDevelopmentSecrets({ ...sessionConfiguration, modelCredentials });
		ledger.acquire("temporary secrets", async function _removeSecrets() { operations.removeLocalDevelopmentSecrets(secrets); });
		const provider = modelCredentials?.kind === "local"
			? { ...modelCredentials, ...prepareLocalLiteLLMConfiguration({ selection: modelCredentials.selection, generatedDirectory: secrets.directory }) }
			: undefined;
		ledger.acquire("Docker network", async function _removeNetwork() { await operations.removeOwnedDockerResource("network", sessionConfiguration.networkName, sessionConfiguration); });
		await operations.ensureOwnedNetwork(sessionConfiguration, { signal: shutdown.signal });
		await operations.ensureOwnedVolume(sessionConfiguration.kurrentVolumeName, sessionConfiguration, { signal: shutdown.signal });
		await operations.ensureOwnedVolume(sessionConfiguration.postgresVolumeName, sessionConfiguration, { signal: shutdown.signal });
		await operations.removeOwnedDockerResource("container", sessionConfiguration.postgresContainerName, sessionConfiguration);
		await operations.removeOwnedDockerResource("container", sessionConfiguration.postgresVolumeProvisionerContainerName, sessionConfiguration);
		ledger.acquire("PostgreSQL volume provisioner", async function _RemovePostgresProvisioner() { await operations.removeOwnedDockerResource("container", sessionConfiguration.postgresVolumeProvisionerContainerName, sessionConfiguration); });
		await operations.runSpecification(createPostgresVolumeProvisionerCommand(sessionConfiguration), sessionConfiguration);
		ledger.acquire("PostgreSQL container", async function _removePostgres() { await operations.removeOwnedDockerResource("container", sessionConfiguration.postgresContainerName, sessionConfiguration); });
		await operations.runSpecification(createPostgresCommand(sessionConfiguration, secrets), sessionConfiguration);
		await operations.waitForPostgres(sessionConfiguration);
		await operations.applyTargetBaseline(sessionConfiguration);
		await operations.removeOwnedDockerResource("container", sessionConfiguration.kurrentContainerName, sessionConfiguration);
		await operations.removeOwnedDockerResource("container", sessionConfiguration.kurrentTlsProvisionerContainerName, sessionConfiguration);
		await operations.removeOwnedDockerResource("volume", sessionConfiguration.kurrentTlsVolumeName, sessionConfiguration);
		ledger.acquire("KurrentDB TLS volume", async function _RemoveKurrentTlsVolume() { await operations.removeOwnedDockerResource("volume", sessionConfiguration.kurrentTlsVolumeName, sessionConfiguration); });
		await operations.ensureOwnedVolume(sessionConfiguration.kurrentTlsVolumeName, sessionConfiguration, { signal: shutdown.signal });
		ledger.acquire("KurrentDB TLS provisioner", async function _RemoveKurrentTlsProvisioner() { await operations.removeOwnedDockerResource("container", sessionConfiguration.kurrentTlsProvisionerContainerName, sessionConfiguration); });
		await operations.runSpecification(createKurrentTlsVolumeCommand(sessionConfiguration, secrets), sessionConfiguration);
		ledger.acquire("KurrentDB container", async function _removeKurrent() { await operations.removeOwnedDockerResource("container", sessionConfiguration.kurrentContainerName, sessionConfiguration); });
		await operations.runSpecification(createKurrentCommand(sessionConfiguration, secrets), sessionConfiguration);
		await operations.bootstrapKurrent(sessionConfiguration, secrets);

		if (provider)
		{
			await operations.removeOwnedDockerResource("container", sessionConfiguration.liteLLMContainerName, sessionConfiguration);
			ledger.acquire("LiteLLM container", async function _removeLiteLLM() { await operations.removeOwnedDockerResource("container", sessionConfiguration.liteLLMContainerName, sessionConfiguration); });
			await operations.runSpecification(createLiteLLMCommand(sessionConfiguration, secrets, provider), sessionConfiguration);
			await operations.waitForLocalLiteLLM(sessionConfiguration, secrets);
		}

		const browserUrl = new URL("/", sessionConfiguration.browserOrigin).toString();
		const launchStatus = [
			`Starting Tier 2 ${sessionConfiguration.developmentProfile}${provider ? ` with ${provider.selection.provider.name}/${provider.selection.model}` : ""}`,
			`Tier 2 browser: ${browserUrl}`,
			`Select "Open current Tier 2 session" when the page loads.`,
		].join("\n");
		operations.writeStatus(`${launchStatus}\n`);
		browserSessionReady = true;
		await operations.runDevelopmentProcesses(createApplicationCommands(sessionConfiguration, secrets), sessionConfiguration.repositoryRoot, { signal: shutdown.signal });
	}
	catch (error)
	{
		if (!shutdown.signal.aborted)
		{
			primaryFailure = error;
		}
	}
	finally
	{
		operations.processHost.removeListener("SIGINT", _stop);
		operations.processHost.removeListener("SIGTERM", _stop);
		operations.processHost.removeListener("SIGHUP", _stop);
		operations.processHost.removeListener("SIGTSTP", _resumeAndStop);

		try
		{
			await ledger.releaseAll();
		}
		catch (cleanupFailure)
		{
			primaryFailure = primaryFailure
				? new AggregateError([primaryFailure, cleanupFailure], "Tier 2 session failed and resource cleanup also failed")
				: cleanupFailure;
		}

		if (browserSessionReady)
			operations.writeStatus("Tier 2 stopped. Close the browser tab from this launch before restarting it.\n");
	}

	if (primaryFailure)
	{
		throw primaryFailure;
	}
}
