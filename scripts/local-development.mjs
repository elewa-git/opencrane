#!/usr/bin/env node

import { createApplicationCommands, createApplicationEnvironment } from "./local-development/commands.mjs";
import { createLocalDevelopmentConfiguration } from "./local-development/configuration.mjs";
import { applyTargetBaseline, ensureLocalLiteLLMDatabase, resetLocalDevelopmentContainers, startLocalLiteLLM, startLocalPostgres, stopOwnedContainer, validateLocalDevelopmentTools } from "./local-development/docker.mjs";
import { createDevelopmentSeedCommand } from "./local-development/development-seed-command.mjs";
import { validateLiteLLMModelEndpoint, waitForLiteLLMModelEndpoint } from "./local-development/litellm-validation.mjs";
import { acquireLocalDevelopmentLock, releaseLocalDevelopmentLock } from "./local-development/lock.mjs";
import { runDevelopmentProcesses } from "./local-development/process-supervisor.mjs";
import { runOneShotCommand } from "./local-development/processes.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES, parseLocalDevelopmentArguments } from "./local-development/profiles.mjs";
import { createDisposableDevelopmentCredentials, loadLocalDevelopmentSecrets, removeDisposableDevelopmentCredentials } from "./local-development/secrets.mjs";

const _HELP = `OpenCrane Tier 2 local development

Usage:
  npm run dev:tier2
  npm run dev:tier2 -- --profile agent [--alternative A|B|C]

Profiles:
  core   PostgreSQL, the watched server, and the live-gateway UI (default)
  agent  Adds the local agent controller; Alternative A is the default

Agent alternatives:
  A  Local LiteLLM with keys/.openai-key
  B  Remote HTTPS LiteLLM with explicit endpoint and admin-key file
  C  Simulated model mode without LiteLLM or provider credentials

Alternative B:
  --remote-litellm-endpoint https://litellm.example.test
  --remote-litellm-master-key-file /absolute/path/to/admin-key

State:
  --reset  Remove only the labelled local PostgreSQL/LiteLLM containers and PostgreSQL volume
`;

async function _main()
{
	const parsed = parseLocalDevelopmentArguments(process.argv.slice(2));

	if (parsed.help)
	{
		process.stdout.write(_HELP);
		return;
	}

	const repositoryRoot = process.cwd();
	const configuration = createLocalDevelopmentConfiguration(parsed, repositoryRoot);
	const lock = acquireLocalDevelopmentLock(repositoryRoot);
	let secrets;
	let developmentCredentials;
	let postgresStarted = false;
	let liteLLMStarted = false;

	try
	{
		validateLocalDevelopmentTools(configuration);
		secrets = loadLocalDevelopmentSecrets(configuration);
		developmentCredentials = createDisposableDevelopmentCredentials();

		if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.RemoteLiteLLM)
		{
			await validateLiteLLMModelEndpoint(configuration.remoteLiteLLMEndpoint, secrets.liteLLMMasterKey);
		}

		if (configuration.reset)
		{
			resetLocalDevelopmentContainers(configuration);
		}

		process.stdout.write(`Starting Tier 2 profile ${configuration.developmentProfile}\n`);
		postgresStarted = await startLocalPostgres(configuration, secrets);
		applyTargetBaseline(configuration);

		const applicationEnvironment = createApplicationEnvironment(configuration, secrets, developmentCredentials);
		runOneShotCommand(createDevelopmentSeedCommand(applicationEnvironment), repositoryRoot);

		if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
		{
			ensureLocalLiteLLMDatabase(configuration);
			liteLLMStarted = await startLocalLiteLLM(configuration, secrets);
			await waitForLiteLLMModelEndpoint(`http://127.0.0.1:${configuration.liteLLMPort}`, secrets.liteLLMMasterKey);
		}

		const commands = createApplicationCommands(configuration, applicationEnvironment);
		await runDevelopmentProcesses(commands, repositoryRoot);
	}
	finally
	{
		try
		{
			if (liteLLMStarted)
			{
				stopOwnedContainer(configuration.liteLLMContainerName);
			}

			if (postgresStarted)
			{
				stopOwnedContainer(configuration.postgresContainerName);
			}
		}
		finally
		{
			try
			{
				if (developmentCredentials)
				{
					removeDisposableDevelopmentCredentials(developmentCredentials);
				}
			}
			finally
			{
				releaseLocalDevelopmentLock(lock);
			}
		}
	}
}

_main().catch(function _reportFailure(error)
{
	process.stderr.write(`Local development failed: ${error.message}\n`);
	process.exitCode = 1;
});
