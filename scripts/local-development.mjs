#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { createLocalDevelopmentConfiguration } from "./local-development/configuration.mjs";
import { runLocalDevelopmentLauncher, shouldRunLocalDevelopmentWorker } from "./local-development/launcher.mjs";
import { runLocalDevelopmentSession } from "./local-development/orchestrator.mjs";
import { parseLocalDevelopmentArguments } from "./local-development/profiles.mjs";

const _HELP = `OpenCrane Tier 2 local development

Usage:
  npm run dev:tier2 [-- --reset]
  npm run dev:tier2:agent [-- --reset]
  npm run dev:tier2:agent:local-llm
  npm run dev:tier2:agent:remote-llm -- --remote-litellm-endpoint https://… --remote-litellm-master-key-file /absolute/path
  npm run dev:tier2:agent:simulated-llm

Profiles:
  core           PostgreSQL, KurrentDB, the current server, and the live-gateway UI
  agent          Core plus the current local Conversation Computer supervisor

Agent alternatives:
  local-llm      Loopback LiteLLM using the first sorted reviewed hidden key and its default model
  remote-llm     Explicit remote HTTPS LiteLLM endpoint and private admin-key file
  simulated-llm  Deterministic model transport without provider credentials

State:
  --reset        Recreate the paired PostgreSQL and KurrentDB fresh-install state
`;

/** Runs the coordinator worker after the foreground launcher has isolated terminal signals. */
async function _runWorker(argumentsList)
{
	const parsed = parseLocalDevelopmentArguments(argumentsList);

	if (parsed.help)
	{
		process.stdout.write(_HELP);
		return;
	}

	const configuration = createLocalDevelopmentConfiguration(parsed, process.cwd());
	await runLocalDevelopmentSession(configuration);
}

/** Selects the foreground signal launcher or the resource-owning worker process. */
async function _main()
{
	const argumentsList = process.argv.slice(2);

	if (shouldRunLocalDevelopmentWorker(process.platform, process.env))
	{
		await _runWorker(argumentsList);
		return;
	}

	process.exitCode = await runLocalDevelopmentLauncher(argumentsList, fileURLToPath(import.meta.url));
}

_main().catch(function _reportFailure(error)
{
	process.stderr.write(`Local development failed: ${error.message}\n`);
	process.exitCode = 1;
});
