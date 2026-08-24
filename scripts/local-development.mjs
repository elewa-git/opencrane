#!/usr/bin/env node

import { createLocalDevelopmentConfiguration } from "./local-development/configuration.mjs";
import { runLocalDevelopmentSession } from "./local-development/orchestrator.mjs";
import { parseLocalDevelopmentArguments } from "./local-development/profiles.mjs";

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
	await runLocalDevelopmentSession(configuration, repositoryRoot);
}

_main().catch(function _reportFailure(error)
{
	process.stderr.write(`Local development failed: ${error.message}\n`);
	process.exitCode = 1;
});
