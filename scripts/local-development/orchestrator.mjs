import fs from "node:fs";

import { prepareLocalLiteLLMConfiguration } from "../../apps/_infra/litellm/local-development/config-generation.mjs";
import { createModelCredentialPlan, readOwnerOnlyCredentialFile } from "../../apps/_infra/litellm/local-development/provider-selection.mjs";
import { runLocalCommand } from "./command-runner.mjs";
import { createApplicationCommands, createKurrentCommand, createKurrentTlsVolumeCommand, createLiteLLMCommand, createPostgresCommand } from "./commands.mjs";
import { applyTargetBaseline, bootstrapKurrent, waitForPostgres } from "./database.mjs";
import { ensureOwnedNetwork, ensureOwnedVolume, removeOwnedDockerResource, resetOwnedPersistentState } from "./docker-resources.mjs";
import { runDevelopmentProcesses } from "./process-supervisor.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";
import { waitForLocalLiteLLM } from "./model-gateway.mjs";
import { createAcquisitionLedger } from "./resource-ledger.mjs";
import { createLocalDevelopmentSecrets, removeLocalDevelopmentSecrets, removePersistentLocalDevelopmentSecrets } from "./secrets.mjs";

/** Runs one command plan through the shared command runner. */
async function _runSpecification(specification, configuration)
{
	await runLocalCommand(specification.command, specification.arguments, { environment: specification.environment, signal: configuration.abortSignal });
}

/** Validates required host commands and immutable repository inputs before acquiring resources. */
async function _validateInputs(configuration)
{
	for (const [command, argumentsList] of [["docker", ["version"]], ["npm", ["--version"]], ["npx", ["--version"]], ["openssl", ["version"]], ["curl", ["--version"]], ["jq", ["--version"]], ["base64", []]])
	{
		await runLocalCommand(command, argumentsList, { signal: configuration.abortSignal });
	}
	for (const requiredPath of [configuration.baselinePath, configuration.seedPath, configuration.kurrentBootstrapPath])
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
		processHost: process,
		...operationOverrides
	};
	const shutdown = new AbortController();
	const ledger = createAcquisitionLedger();
	const sessionConfiguration = { ...configuration, abortSignal: shutdown.signal };
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
	operations.processHost.once("SIGTSTP", _resumeAndStop);
	let primaryFailure;
	try
	{
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
		await operations.ensureOwnedVolume(sessionConfiguration.postgresVolumeName, sessionConfiguration, { signal: shutdown.signal });
		await operations.ensureOwnedVolume(sessionConfiguration.kurrentVolumeName, sessionConfiguration, { signal: shutdown.signal });
		await operations.removeOwnedDockerResource("container", sessionConfiguration.postgresContainerName, sessionConfiguration);
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
		process.stdout.write(`Starting Tier 2 ${sessionConfiguration.developmentProfile}${provider ? ` with ${provider.selection.provider.name}/${provider.selection.model}` : ""}\n`);
		process.stdout.write(`Open the private Tier 2 browser URL: http://local-development.localhost:4200/?development-session=${encodeURIComponent(secrets.browserSessionCredential)}\n`);
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
	}
	if (primaryFailure)
	{
		throw primaryFailure;
	}
}
