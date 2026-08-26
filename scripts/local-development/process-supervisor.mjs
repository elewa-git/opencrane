import { spawn } from "node:child_process";

import { createToolchainProcessEnvironment } from "./process-environments.mjs";

/**
 * Keeps the reviewed toolchain variables and adds the environment for one Tier 2 child process.
 * Parent credentials outside that allowlist cannot leak into the server, UI, controller, or runtime.
 */
export function createDevelopmentChildEnvironment(parentEnvironment, processEnvironment = {})
{
	return createToolchainProcessEnvironment(parentEnvironment, processEnvironment);
}

/**
 * Runs the Tier 2 process group and terminates the remaining children when one exits.
 * Interrupt, termination, and terminal-suspend requests use the same shutdown path so the
 * coordinator can release its lock and owned containers, with a five-second forced-stop fallback.
 *
 * @param {readonly object[]} specifications - Commands that form the selected Tier 2 composition.
 * @param {string} repositoryRoot - Working directory inherited by every child process.
 * @param {{ readonly processHost?: typeof process, readonly signal?: AbortSignal, readonly spawnProcess?: typeof spawn }} operations - Injectable process seams for lifecycle tests.
 * @returns {Promise<void>} Resolves after every child closes during a requested shutdown.
 * @throws Rejects when a child cannot start or exits before shutdown begins.
 */
export async function runDevelopmentProcesses(specifications, repositoryRoot, operations = {})
{
	const processHost = operations.processHost ?? process;
	const spawnProcess = operations.spawnProcess ?? spawn;
	const shutdownSignal = operations.signal;
	const children = specifications.map(function _start(specification)
	{
		const child = spawnProcess(specification.command, specification.arguments, {
			cwd: repositoryRoot,
			env: createDevelopmentChildEnvironment(processHost.env, specification.environment),
			stdio: "inherit"
		});

		return {
			...specification,
			child
		};
	});

	return new Promise(function _awaitProcesses(resolve, reject)
	{
		const remaining = new Set(children);
		let failure;
		let shuttingDown = false;
		let forceTimer;

		function _finishWhenClosed()
		{
			if (remaining.size !== 0)
			{
				return;
			}

			clearTimeout(forceTimer);
			processHost.removeListener("SIGINT", _onInterrupt);
			processHost.removeListener("SIGTERM", _onTerminate);
			processHost.removeListener("SIGTSTP", _onSuspend);
			shutdownSignal?.removeEventListener("abort", _onAbort);

			if (failure)
			{
				reject(failure);
			}
			else
			{
				resolve();
			}
		}

		function _beginShutdown(reason)
		{
			if (shuttingDown)
			{
				return;
			}

			shuttingDown = true;
			failure = reason;

			for (const entry of remaining)
			{
				entry.child.kill("SIGTERM");
			}

			forceTimer = setTimeout(function _forceShutdown()
			{
				for (const entry of remaining)
				{
					entry.child.kill("SIGKILL");
				}
			}, 5_000);
		}

		function _onInterrupt()
		{
			_beginShutdown(undefined);
		}

		function _onTerminate()
		{
			_beginShutdown(undefined);
		}

		function _onSuspend()
		{
			if (processHost.platform !== "win32")
			{
				processHost.kill(0, "SIGCONT");
			}

			_beginShutdown(undefined);
		}

		function _onAbort()
		{
			_beginShutdown(undefined);
		}

		if (shutdownSignal)
		{
			shutdownSignal.addEventListener("abort", _onAbort, { once: true });

			if (shutdownSignal.aborted)
			{
				_onAbort();
			}
		}
		else
		{
			processHost.once("SIGINT", _onInterrupt);
			processHost.once("SIGTERM", _onTerminate);
			processHost.once("SIGTSTP", _onSuspend);
		}

		for (const entry of children)
		{
			entry.child.once("error", function _onError(error)
			{
				_beginShutdown(new Error(`${entry.name} could not start: ${error.message}`));
			});
			entry.child.once("close", function _onClose(code, signal)
			{
				remaining.delete(entry);

				if (!shuttingDown)
				{
					_beginShutdown(new Error(`${entry.name} exited early (${signal ?? `exit ${code}`})`));
				}

				_finishWhenClosed();
			});
		}
	});
}
