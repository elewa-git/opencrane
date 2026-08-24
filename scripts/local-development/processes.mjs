import { spawnSync } from "node:child_process";

export function runOneShotCommand(specification, repositoryRoot)
{
	const result = spawnSync(specification.command, specification.arguments, {
		cwd: repositoryRoot,
		env: {
			...process.env,
			...specification.environment
		},
		stdio: "inherit"
	});

	if (result.error)
	{
		throw result.error;
	}

	if (result.status !== 0)
	{
		throw new Error(`${specification.name} failed with exit ${result.status}`);
	}
}
