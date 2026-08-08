import { execFileSync, spawnSync } from "node:child_process";

/** Maximum captured output for broad-but-reviewable PR diffs and patch IDs. */
export const COMMAND_OUTPUT_MAX_BYTES = 16 * 1024 * 1024;

/** Create a bounded, injectable command adapter for repository governance tooling. */
export function createCommandRunner(timeoutMilliseconds = 30_000)
{
	return {
		run(command, arguments_, options = {})
		{
			return execFileSync(command, arguments_, {
				...options,
				encoding: "utf8",
				maxBuffer: COMMAND_OUTPUT_MAX_BYTES,
				timeout: timeoutMilliseconds,
			}).trim();
		},
		runBuffer(command, arguments_)
		{
			return execFileSync(command, arguments_, {
				maxBuffer: COMMAND_OUTPUT_MAX_BYTES,
				timeout: timeoutMilliseconds,
			});
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
