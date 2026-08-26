import fs from "node:fs";
import { runLocalCommand } from "./command-runner.mjs";
import { LOCAL_DEVELOPMENT_ALTERNATIVES } from "./profiles.mjs";

export { removeOwnedContainer, resetLocalDevelopmentContainers, startLocalLiteLLM, stopOwnedContainer } from "./container-resources.mjs";
export { applyTargetBaseline, ensureLocalLiteLLMDatabase, startLocalPostgres } from "./postgres.mjs";

/**
 * Checks the host tools and repository inputs before the coordinator creates credentials or containers.
 * Agent profiles also require the pinned Python dependency list used to prepare their runtime.
 *
 * @throws Rejects when a required command or repository input is unavailable, or the session stops.
 */
export async function validateLocalDevelopmentTools(configuration)
{
	const commands = ["docker", "npm", "npx"];

	for (const command of commands)
	{
		await runLocalCommand(command, ["--version"], { signal: configuration.abortSignal });
	}

	const requiredFiles = [configuration.baselinePath, configuration.seedPath];

	if (configuration.alternative === LOCAL_DEVELOPMENT_ALTERNATIVES.LocalLiteLLM)
	{
		requiredFiles.push(configuration.liteLLMConfigPath);
	}

	if (configuration.profile === "agent")
	{
		requiredFiles.push(configuration.runtimeRequirementsPath);
	}

	for (const requiredFile of requiredFiles)
	{
		if (!fs.existsSync(requiredFile))
		{
			throw new Error(`Required local-development file is missing: ${requiredFile}`);
		}
	}
}
