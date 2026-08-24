import { spawnSync } from "node:child_process";

export function runLocalCommand(command, argumentsList, options = {})
{
	const result = spawnSync(command, argumentsList, {
		cwd: options.cwd,
		env: {
			...process.env,
			...options.environment
		},
		encoding: "utf8",
		input: options.input,
		stdio: options.inherit ? "inherit" : "pipe"
	});

	if (result.error)
	{
		throw result.error;
	}

	if (result.status !== 0 && !options.acceptFailure)
	{
		const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
		throw new Error(`${command} ${argumentsList.join(" ")} failed: ${detail}`);
	}

	return result;
}

export function runLocalCommandSpecification(specification)
{
	runLocalCommand(specification.command, specification.arguments, { environment: specification.environment });
}
