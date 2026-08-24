import fs from "node:fs";
import { runLocalCommand } from "./command-runner.mjs";

export { resetLocalDevelopmentContainers, startLocalLiteLLM, stopOwnedContainer } from "./container-resources.mjs";
export { applyTargetBaseline, startLocalPostgres } from "./postgres.mjs";

export function validateLocalDevelopmentTools(configuration)
{
	for (const command of ["docker", "npm", "npx"])
	{
		runLocalCommand(command, ["--version"]);
	}

	const requiredFiles = [configuration.baselinePath, configuration.seedPath];

	if (configuration.alternative === "A")
	{
		requiredFiles.push(configuration.liteLLMConfigPath);
	}

	for (const requiredFile of requiredFiles)
	{
		if (!fs.existsSync(requiredFile))
		{
			throw new Error(`Required local-development file is missing: ${requiredFile}`);
		}
	}
}
