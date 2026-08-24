import { spawn } from "node:child_process";

export async function runDevelopmentProcesses(specifications, repositoryRoot)
{
	const children = specifications.map(function _start(specification)
	{
		const child = spawn(specification.command, specification.arguments, {
			cwd: repositoryRoot,
			env: {
				...process.env,
				...specification.environment
			},
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
			process.removeListener("SIGINT", _onInterrupt);
			process.removeListener("SIGTERM", _onTerminate);

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

		process.once("SIGINT", _onInterrupt);
		process.once("SIGTERM", _onTerminate);

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
