#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { createLocalDevelopmentConfiguration } from "./local-development/configuration.mjs";
import { shouldRunLocalDevelopmentWorker, runLocalDevelopmentLauncher } from "./local-development/launcher.mjs";
import { runLocalDevelopmentSession } from "./local-development/orchestrator.mjs";
import { parseLocalDevelopmentArguments } from "./local-development/profiles.mjs";

const _HELP = `OpenCrane Tier 2 local development

Usage:
  npm run dev:tier2
  npm run dev:tier2:agent
  npm run dev:tier2:agent:local-llm
  npm run dev:tier2:agent:local-llm -- --provider anthropic
  npm run dev:tier2:agent:local-llm -- --model anthropic/claude-sonnet-4-5-20250929
  npm run dev:tier2:agent:remote-llm -- --remote-litellm-endpoint https://… --remote-litellm-master-key-file /absolute/path
  npm run dev:tier2:agent:simulated-llm

Profiles:
  core   PostgreSQL, the watched server, and the live-gateway UI (default)
  agent  Adds the local agent controller; local-llm is the default

Agent alternatives:
  local-llm      Local LiteLLM; defaults to the first recognized key in sorted keys/ order
  remote-llm     Remote HTTPS LiteLLM with explicit endpoint and admin-key file
  simulated-llm  Simulated model mode without LiteLLM or provider credentials

Alternative A:
  --provider <reviewed-provider>
  --model <reviewed-provider/model>
  A provider uses its defaultModel unless --model selects another model that it owns.
  The registry derives the hidden credential path keys/.<provider>-key.

Alternative B:
  --remote-litellm-endpoint https://litellm.example.test
  --remote-litellm-master-key-file /absolute/path/to/admin-key

State:
  --reset  Remove only the labelled local PostgreSQL/LiteLLM containers and PostgreSQL volume
`;

async function _runWorker(argumentsList)
{
	const parsed = parseLocalDevelopmentArguments(argumentsList);

	if (parsed.help)
	{
		process.stdout.write(_HELP);
		return;
	}

	const repositoryRoot = process.cwd();
	const configuration = createLocalDevelopmentConfiguration(parsed, repositoryRoot);
	await runLocalDevelopmentSession(configuration);
}

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
