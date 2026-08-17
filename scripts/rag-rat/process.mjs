import { spawnSync } from "node:child_process";

/**
 * Runs one inherited-stdio child process and normalizes launch failures into an exit status.
 *
 * Called by: the rag-rat CLI composition root for npm installation and native commands.
 *
 * @param {string} command Executable to launch.
 * @param {readonly string[]} arguments_ Arguments passed without shell interpolation.
 * @param {{ readonly cwd: string; readonly env: NodeJS.ProcessEnv }} options Process environment.
 * @param {typeof spawnSync} runner Injectable child-process boundary used by focused tests.
 * @returns {{ readonly status: number; readonly errorMessage?: string }} Normalized process result.
 * @throws {Error} When the injected runner throws instead of returning a process result.
 */
export function ___RunAgentContextProcess(command, arguments_, options, runner = spawnSync)
{
	const result = runner(command, arguments_, {
		cwd: options.cwd,
		env: options.env,
		stdio: "inherit",
	});

	if (result.error)
	{
		return Object.freeze({ status: 1, errorMessage: result.error.message });
	}

	return Object.freeze({ status: result.status ?? 1 });
}
