import { execFileSync, spawnSync } from "node:child_process";

/** Create a bounded, injectable command adapter for repository governance tooling. */
export function createCommandRunner(timeoutMilliseconds = 30_000)
{
	return {
		run(command, arguments_, options = {})
		{
			return execFileSync(command, arguments_, {
				encoding: "utf8",
				timeout: timeoutMilliseconds,
				...options,
			}).trim();
		},
		runBuffer(command, arguments_)
		{
			return execFileSync(command, arguments_, { timeout: timeoutMilliseconds });
		},
		status(command, arguments_)
		{
			const result = spawnSync(command, arguments_, { timeout: timeoutMilliseconds });
			if (result.error)
			{
				throw result.error;
			}
			return result.status;
		},
	};
}
