import { createApplicationCommands, createApplicationEnvironment } from "./commands.mjs";
import { applyTargetBaseline, ensureLocalLiteLLMDatabase, resetLocalDevelopmentContainers, startLocalLiteLLM, startLocalPostgres, stopOwnedContainer, validateLocalDevelopmentTools } from "./docker.mjs";
import { createDevelopmentSeedCommand } from "./development-seed-command.mjs";
import { validateLiteLLMModelEndpoint, waitForLiteLLMModelEndpoint } from "./litellm-validation.mjs";
import { acquireLocalDevelopmentLock, releaseLocalDevelopmentLock } from "./lock.mjs";
import { runDevelopmentProcesses } from "./process-supervisor.mjs";
import { runOneShotCommand } from "./processes.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";
import { createDisposableDevelopmentCredentials, loadLocalDevelopmentSecrets, removeDisposableDevelopmentCredentials } from "./secrets.mjs";

const _OPERATIONS = {
	acquireLocalDevelopmentLock,
	applyTargetBaseline,
	createApplicationCommands,
	createApplicationEnvironment,
	createDevelopmentSeedCommand,
	createDisposableDevelopmentCredentials,
	ensureLocalLiteLLMDatabase,
	loadLocalDevelopmentSecrets,
	releaseLocalDevelopmentLock,
	removeDisposableDevelopmentCredentials,
	resetLocalDevelopmentContainers,
	runDevelopmentProcesses,
	runOneShotCommand,
	startLocalLiteLLM,
	startLocalPostgres,
	stopOwnedContainer,
	validateLiteLLMModelEndpoint,
	validateLocalDevelopmentTools,
	waitForLiteLLMModelEndpoint,
	writeStatus(message)
	{
		process.stdout.write(message);
	}
};

/**
 * Run one Tier 2 composition and release every resource owned by this coordinator.
 *
 * Called by: `scripts/local-development.mjs` after parsing and validating CLI configuration.
 * @param {import("./configuration.mjs").LocalDevelopmentConfiguration} configuration - Selected core or Agent composition.
 * @param {string} repositoryRoot - Absolute repository root used by child commands and the coordinator lock.
 * @param {Partial<typeof _OPERATIONS>} operationOverrides - Offline seams for orchestration contract tests.
 */
export async function runLocalDevelopmentSession(configuration, repositoryRoot, operationOverrides = {})
{
	const operations = {
		..._OPERATIONS,
		...operationOverrides
	};
	const lock = operations.acquireLocalDevelopmentLock(repositoryRoot);
	let secrets;
	let developmentCredentials;
	let postgresStarted = false;
	let liteLLMStarted = false;

	try
	{
		operations.validateLocalDevelopmentTools(configuration);
		secrets = operations.loadLocalDevelopmentSecrets(configuration);
		developmentCredentials = operations.createDisposableDevelopmentCredentials();

		if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
		{
			await operations.validateLiteLLMModelEndpoint(configuration.remoteLiteLLMEndpoint, secrets.liteLLMMasterKey);
		}

		if (configuration.reset)
		{
			operations.resetLocalDevelopmentContainers(configuration);
		}

		operations.writeStatus(`Starting Tier 2 profile ${configuration.developmentProfile}\n`);
		postgresStarted = await operations.startLocalPostgres(configuration, secrets);
		operations.applyTargetBaseline(configuration);

		const applicationEnvironment = operations.createApplicationEnvironment(configuration, secrets, developmentCredentials);
		operations.runOneShotCommand(operations.createDevelopmentSeedCommand(applicationEnvironment), repositoryRoot);

		if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
		{
			operations.ensureLocalLiteLLMDatabase(configuration);
			liteLLMStarted = await operations.startLocalLiteLLM(configuration, secrets);
			await operations.waitForLiteLLMModelEndpoint(`http://127.0.0.1:${configuration.liteLLMPort}`, secrets.liteLLMMasterKey);
		}

		const commands = operations.createApplicationCommands(configuration, applicationEnvironment);
		await operations.runDevelopmentProcesses(commands, repositoryRoot);
	}
	finally
	{
		try
		{
			if (liteLLMStarted)
			{
				operations.stopOwnedContainer(configuration.liteLLMContainerName);
			}

			if (postgresStarted)
			{
				operations.stopOwnedContainer(configuration.postgresContainerName);
			}
		}
		finally
		{
			try
			{
				if (developmentCredentials)
				{
					operations.removeDisposableDevelopmentCredentials(developmentCredentials);
				}
			}
			finally
			{
				operations.releaseLocalDevelopmentLock(lock);
			}
		}
	}
}
