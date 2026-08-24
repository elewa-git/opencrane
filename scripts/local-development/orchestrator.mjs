import { createApplicationCommands, createApplicationEnvironment } from "./commands.mjs";
import { applyTargetBaseline, ensureLocalLiteLLMDatabase, resetLocalDevelopmentContainers, startLocalLiteLLM, startLocalPostgres, stopOwnedContainer, validateLocalDevelopmentTools } from "./docker.mjs";
import { createDevelopmentSeedCommand } from "./development-seed-command.mjs";
import { validateLiteLLMModelEndpoint, waitForLiteLLMModelEndpoint } from "./litellm-validation.mjs";
import { acquireLocalDevelopmentLock, releaseLocalDevelopmentLock } from "./lock.mjs";
import { runLocalCommandSpecification } from "./command-runner.mjs";
import { runDevelopmentProcesses } from "./process-supervisor.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES, LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";
import { prepareLocalAgentRuntimeEnvironment } from "./python-runtime.mjs";
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
	prepareLocalAgentRuntimeEnvironment,
	releaseLocalDevelopmentLock,
	removeDisposableDevelopmentCredentials,
	resetLocalDevelopmentContainers,
	runDevelopmentProcesses,
	runLocalCommandSpecification,
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
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Selected core or Agent composition.
 * @param {Partial<typeof _OPERATIONS>} operationOverrides - Offline seams for orchestration contract tests.
 */
export async function runLocalDevelopmentSession(configuration, operationOverrides = {})
{
	const operations = {
		..._OPERATIONS,
		...operationOverrides
	};
	const lock = operations.acquireLocalDevelopmentLock(configuration.repositoryRoot);
	let secrets;
	let developmentCredentials;
	let postgresStarted = false;
	let liteLLMStarted = false;

	try
	{
		operations.validateLocalDevelopmentTools(configuration);

		if (configuration.profile === LOCAL_DEVELOPMENT_PROFILES.Agent)
		{
			operations.prepareLocalAgentRuntimeEnvironment(configuration);
		}

		secrets = operations.loadLocalDevelopmentSecrets(configuration);
		developmentCredentials = operations.createDisposableDevelopmentCredentials(configuration.profile === LOCAL_DEVELOPMENT_PROFILES.Agent);

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
		operations.runLocalCommandSpecification(operations.createDevelopmentSeedCommand(applicationEnvironment), {
			cwd: configuration.repositoryRoot,
			inherit: true
		});

		if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
		{
			operations.ensureLocalLiteLLMDatabase(configuration);
			liteLLMStarted = await operations.startLocalLiteLLM(configuration, secrets);
			await operations.waitForLiteLLMModelEndpoint(`http://127.0.0.1:${configuration.liteLLMPort}`, secrets.liteLLMMasterKey);
		}

		const commands = operations.createApplicationCommands(configuration, applicationEnvironment);
		await operations.runDevelopmentProcesses(commands, configuration.repositoryRoot);
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
