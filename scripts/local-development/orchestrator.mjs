import { createApplicationCommands, createApplicationEnvironment } from "./commands.mjs";
import { applyTargetBaseline, ensureLocalLiteLLMDatabase, removeOwnedContainer, resetLocalDevelopmentContainers, startLocalLiteLLM, startLocalPostgres, stopOwnedContainer, validateLocalDevelopmentTools } from "./docker.mjs";
import { createDevelopmentSeedCommand } from "./development-seed-command.mjs";
import { validateLiteLLMModelEndpoint, waitForLiteLLMModelEndpoint } from "./litellm-validation.mjs";
import { acquireLocalDevelopmentLock, releaseLocalDevelopmentLock } from "./lock.mjs";
import { runLocalCommandSpecification } from "./command-runner.mjs";
import { runDevelopmentProcesses } from "./process-supervisor.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES, LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";
import { prepareLocalProviderConfiguration } from "./local-provider-configurations.mjs";
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
	prepareLocalProviderConfiguration,
	processHost: process,
	releaseLocalDevelopmentLock,
	removeOwnedContainer,
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
 * Runs one Tier 2 composition and releases every resource owned by this coordinator.
 * Interrupt, termination, and terminal-suspend requests cancel setup or child processes before the
 * `finally` path stops containers, removes temporary credentials, and releases the session lock.
 * A terminal-suspend request first resumes the process group because stopped children cannot finish
 * graceful termination.
 *
 * Called by: `scripts/local-development.mjs` after parsing and validating CLI configuration.
 * @param {ReturnType<typeof import("./configuration.mjs").createLocalDevelopmentConfiguration>} configuration - Selected core or Agent composition.
 * @param {Partial<typeof _OPERATIONS>} operationOverrides - Offline seams for orchestration contract tests.
 * @returns {Promise<void>} Resolves after a requested shutdown finishes cleanup.
 * @throws Rejects with setup and child-process failures after attempting the same cleanup.
 */
export async function runLocalDevelopmentSession(configuration, operationOverrides = {})
{
	const operations = {
		..._OPERATIONS,
		...operationOverrides
	};
	const shutdownController = new AbortController();
	const shutdownReason = new Error("Tier 2 local development stopped");
	let lock;
	let secrets;
	let developmentCredentials;
	let postgresStarted = false;
	let liteLLMStarted = false;

	function _requestShutdown()
	{
		shutdownController.abort(shutdownReason);
	}

	function _resumeAndShutdown()
	{
		try
		{
			if (operations.processHost.platform !== "win32")
			{
				operations.processHost.kill(0, "SIGCONT");
			}
		}
		finally
		{
			_requestShutdown();
		}
	}

	operations.processHost.once("SIGINT", _requestShutdown);
	operations.processHost.once("SIGTERM", _requestShutdown);
	operations.processHost.once("SIGTSTP", _resumeAndShutdown);

	try
	{
		lock = operations.acquireLocalDevelopmentLock(configuration.repositoryRoot);
		let sessionConfiguration = {
			...configuration,
			abortSignal: shutdownController.signal
		};
		await operations.validateLocalDevelopmentTools(sessionConfiguration);
		shutdownController.signal.throwIfAborted();

		if (sessionConfiguration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
		{
			const localProviderConfiguration = operations.prepareLocalProviderConfiguration(sessionConfiguration);
			sessionConfiguration = {
				...sessionConfiguration,
				...localProviderConfiguration
			};
			operations.writeStatus(`Selected local model ${sessionConfiguration.selectedModel} from ${sessionConfiguration.selectedProvider}\n`);
			shutdownController.signal.throwIfAborted();
		}

		secrets = operations.loadLocalDevelopmentSecrets(sessionConfiguration);
		shutdownController.signal.throwIfAborted();

		// The coordinator validates remote inputs before Python setup so a bad endpoint or key cannot trigger dependency downloads.
		if (sessionConfiguration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
		{
			await operations.validateLiteLLMModelEndpoint(sessionConfiguration.remoteLiteLLMEndpoint, secrets.liteLLMMasterKey, undefined, shutdownController.signal);
			shutdownController.signal.throwIfAborted();
		}

		if (sessionConfiguration.profile === LOCAL_DEVELOPMENT_PROFILES.Agent)
		{
			await operations.prepareLocalAgentRuntimeEnvironment(sessionConfiguration);
			shutdownController.signal.throwIfAborted();
		}

		developmentCredentials = operations.createDisposableDevelopmentCredentials(sessionConfiguration.profile === LOCAL_DEVELOPMENT_PROFILES.Agent);
		shutdownController.signal.throwIfAborted();

		if (sessionConfiguration.reset)
		{
			await operations.resetLocalDevelopmentContainers(sessionConfiguration);
			shutdownController.signal.throwIfAborted();
		}

		operations.writeStatus(`Starting Tier 2 profile ${sessionConfiguration.developmentProfile}\n`);
		postgresStarted = await operations.startLocalPostgres(sessionConfiguration, secrets);
		shutdownController.signal.throwIfAborted();
		await operations.applyTargetBaseline(sessionConfiguration);
		shutdownController.signal.throwIfAborted();

		const applicationEnvironment = operations.createApplicationEnvironment(sessionConfiguration, secrets, developmentCredentials);
		await operations.runLocalCommandSpecification(operations.createDevelopmentSeedCommand(applicationEnvironment), {
			cwd: sessionConfiguration.repositoryRoot,
			inherit: true,
			signal: shutdownController.signal
		});
		shutdownController.signal.throwIfAborted();

		if (sessionConfiguration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
		{
			await operations.ensureLocalLiteLLMDatabase(sessionConfiguration);
			shutdownController.signal.throwIfAborted();
			liteLLMStarted = await operations.startLocalLiteLLM(sessionConfiguration, secrets);
			shutdownController.signal.throwIfAborted();
			await operations.waitForLiteLLMModelEndpoint(`http://127.0.0.1:${sessionConfiguration.liteLLMPort}`, secrets.liteLLMMasterKey, undefined, shutdownController.signal);
			shutdownController.signal.throwIfAborted();
		}

		const commands = operations.createApplicationCommands(sessionConfiguration, applicationEnvironment);
		await operations.runDevelopmentProcesses(commands, sessionConfiguration.repositoryRoot, { signal: shutdownController.signal });
	}
	catch (error)
	{
		if (error !== shutdownReason)
		{
			throw error;
		}
	}
	finally
	{
		try
		{
			if (liteLLMStarted)
			{
				await operations.removeOwnedContainer(configuration.liteLLMContainerName);
			}

			if (postgresStarted)
			{
				await operations.stopOwnedContainer(configuration.postgresContainerName);
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
				try
				{
					if (lock)
					{
						operations.releaseLocalDevelopmentLock(lock);
					}
				}
				finally
				{
					operations.processHost.removeListener("SIGINT", _requestShutdown);
					operations.processHost.removeListener("SIGTERM", _requestShutdown);
					operations.processHost.removeListener("SIGTSTP", _resumeAndShutdown);
				}
			}
		}
	}
}
