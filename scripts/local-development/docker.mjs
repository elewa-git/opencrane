import fs from "node:fs";
import { runLocalCommand } from "./command-runner.mjs";

export { removeOwnedContainer, resetLocalDevelopmentContainers, startLocalLiteLLM, stopOwnedContainer } from "./container-resources.mjs";
export { applyTargetBaseline, ensureLocalLiteLLMDatabase, startLocalPostgres } from "./postgres.mjs";

/**
 * Checks the host tools and repository inputs required before the coordinator mutates local state.
 * Agent profiles also require the pinned Python dependency list used to prepare their runtime.
 */
export function validateLocalDevelopmentTools(configuration)
{
	const commands = ["docker", "npm", "npx"];

	for (const command of commands)
	{
		runLocalCommand(command, ["--version"]);
	}

	const requiredFiles = [configuration.baselinePath, configuration.seedPath];

	if (configuration.alternative === "A")
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
