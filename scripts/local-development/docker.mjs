import fs from "node:fs";
import { runLocalCommand } from "./command-runner.mjs";

export { resetLocalDevelopmentContainers, startLocalLiteLLM, stopOwnedContainer } from "./container-resources.mjs";
export { applyTargetBaseline, ensureLocalLiteLLMDatabase, startLocalPostgres } from "./postgres.mjs";

export function validateLocalDevelopmentTools(configuration)
{
	const commands = ["docker", "npm", "npx"];

	if (configuration.profile === "agent")
	{
		commands.push("python3");
	}

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
