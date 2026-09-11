import { spawn } from "node:child_process";

import { _SignalDevelopmentProcessTree } from "./process-group.mjs";
import { createLocalChildEnvironment } from "./command-runner.mjs";

/** Runs all watched children and stops every process group when one child fails or the session aborts. */
export async function runDevelopmentProcesses(specifications, repositoryRoot, options = {})
{
	const processHost = options.processHost ?? process;
	const spawnProcess = options.spawnProcess ?? spawn;
	const children = specifications.map(function _start(specification)
	{
		const child = spawnProcess(specification.command, specification.arguments, {
			cwd: repositoryRoot,
			detached: processHost.platform !== "win32",
			env: createLocalChildEnvironment(processHost.env, specification.environment),
			stdio: "inherit"
		});

		return { ...specification, child };
	});

	return await new Promise(function _waitForChildren(resolve, reject)
	{
		const remaining = new Set(children);
		let failure;
		let shuttingDown = false;
		let forceTimer;

		function _finish()
		{
			if (remaining.size > 0)
			{
				return;
			}

			clearTimeout(forceTimer);
			options.signal?.removeEventListener("abort", _onAbort);

			if (failure)
			{
				reject(failure);
			}
			else
			{
				resolve();
			}
		}

		function _shutdown(reason)
		{
			if (shuttingDown)
			{
				return;
			}

			shuttingDown = true;
			failure = reason;

			for (const entry of children)
			{
				_SignalDevelopmentProcessTree(entry.child, "SIGTERM", processHost);
			}

			forceTimer = setTimeout(function _forceShutdown()
			{
				for (const entry of children)
				{
					_SignalDevelopmentProcessTree(entry.child, "SIGKILL", processHost);
				}
			}, options.shutdownGraceMilliseconds ?? 5_000);
		}

		function _onAbort()
		{
			_shutdown(undefined);
		}

		options.signal?.addEventListener("abort", _onAbort, { once: true });

		if (options.signal?.aborted)
		{
			_onAbort();
		}

		for (const entry of children)
		{
			entry.child.once("error", function _onError(error)
			{
				_shutdown(new Error(`${entry.name} could not start: ${error.message}`));
			});
			entry.child.once("close", function _onClose(code, signal)
			{
				remaining.delete(entry);

				if (!shuttingDown)
				{
					_shutdown(new Error(`${entry.name} exited early (${signal ?? `exit ${code}`})`));
				}

				_finish();
			});
		}
	});
}
