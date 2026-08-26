import { spawn } from "node:child_process";

/** Marks a spawned child as the coordinator worker so it does not create another worker. */
export const LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT = "OPENCRANE_LOCAL_DEVELOPMENT_WORKER";

/**
 * Decides whether this process runs the coordinator or starts a separate worker.
 * POSIX systems use the separate worker so the foreground launcher receives each terminal signal
 * once. Windows runs the coordinator directly because Node cannot forward those POSIX signals to a
 * child without skipping the coordinator's container cleanup.
 *
 * @param {NodeJS.Platform} platform - Platform running the local-development command.
 * @param {NodeJS.ProcessEnv} environment - Process variables inherited by the launcher or worker.
 * @returns {boolean} True when this process must run the coordinator itself.
 */
export function shouldRunLocalDevelopmentWorker(platform, environment)
{
	return platform === "win32" || environment[LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT] === "true";
}

/**
 * Runs the coordinator in a separate process group while the launcher receives terminal signals.
 * Keeping the worker out of the foreground group prevents one Ctrl+C or Ctrl+Z from reaching both
 * processes. The launcher treats the first signal as a graceful shutdown request and waits while
 * the worker cleans up.
 *
 * @param {readonly string[]} argumentsList - User arguments forwarded unchanged to the coordinator worker.
 * @param {string} entrypointPath - Absolute local-development entrypoint executed by Node.
 * @param {{ readonly processHost?: typeof process, readonly spawnProcess?: typeof spawn }} operations - Injectable process APIs for lifecycle tests.
 * @returns {Promise<number>} Worker exit code after its cleanup path completes.
 * @throws Rejects when the coordinator worker cannot start.
 */
export async function runLocalDevelopmentLauncher(argumentsList, entrypointPath, operations = {})
{
	const processHost = operations.processHost ?? process;
	const spawnProcess = operations.spawnProcess ?? spawn;
	const child = spawnProcess(processHost.execPath, [entrypointPath, ...argumentsList], {
		detached: processHost.platform !== "win32",
		env: {
			...processHost.env,
			[LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT]: "true"
		},
		stdio: "inherit"
	});

	return new Promise(function _waitForWorker(resolve, reject)
	{
		let shutdownRequested = false;
		let settled = false;

		function _finish(callback)
		{
			if (settled)
			{
				return;
			}

			settled = true;
			processHost.removeListener("SIGINT", _onInterrupt);
			processHost.removeListener("SIGTERM", _onTerminate);
			processHost.removeListener("SIGTSTP", _onSuspend);
			callback();
		}

		function _requestShutdown(signal)
		{
			if (shutdownRequested)
			{
				return;
			}

			shutdownRequested = true;
			child.kill(signal);
		}

		function _onInterrupt()
		{
			_requestShutdown("SIGINT");
		}

		function _onTerminate()
		{
			_requestShutdown("SIGTERM");
		}

		function _onSuspend()
		{
			if (processHost.platform !== "win32")
			{
				// Resume npm and shell wrappers before turning Ctrl+Z into shutdown.
				// Otherwise, the wrappers stay suspended after cleanup.
				processHost.kill(0, "SIGCONT");
			}

			_requestShutdown("SIGINT");
		}

		processHost.on("SIGINT", _onInterrupt);
		processHost.on("SIGTERM", _onTerminate);
		processHost.on("SIGTSTP", _onSuspend);
		child.once("error", function _onError(error)
		{
			_finish(function _rejectStart() { reject(error); });
		});
		child.once("close", function _onClose(code, signal)
		{
			_finish(function _resolveWorker() { resolve(code ?? (signal ? 1 : 0)); });
		});
	});
}
