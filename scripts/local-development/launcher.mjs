import { spawn } from "node:child_process";

/** Marks the resource-owning worker and prevents recursive launcher creation. */
const LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT = "OPENCRANE_LOCAL_DEVELOPMENT_WORKER";

/** Selects direct execution on Windows or the isolated worker everywhere else. */
export function shouldRunLocalDevelopmentWorker(platform, environment)
{
	return platform === "win32" || environment[LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT] === "true";
}

/** Isolates the worker from terminal signals and converts suspend into graceful shutdown. */
export async function runLocalDevelopmentLauncher(argumentsList, entrypointPath, options = {})
{
	const processHost = options.processHost ?? process;
	const spawnProcess = options.spawnProcess ?? spawn;
	const child = spawnProcess(processHost.execPath, [entrypointPath, ...argumentsList], {
		detached: processHost.platform !== "win32",
		env: { ...processHost.env, [LOCAL_DEVELOPMENT_WORKER_ENVIRONMENT]: "true" },
		stdio: "inherit"
	});

	return await new Promise(function _waitForWorker(resolve, reject)
	{
		let requested = false;

		function _removeListeners()
		{
			processHost.removeListener("SIGINT", _onInterrupt);
			processHost.removeListener("SIGTERM", _onTerminate);
			processHost.removeListener("SIGTSTP", _onSuspend);
		}

		function _request(signal)
		{
			if (!requested)
			{
				requested = true;
				child.kill(signal);
			}
		}

		function _onInterrupt() { _request("SIGINT"); }
		function _onTerminate() { _request("SIGTERM"); }
		function _onSuspend()
		{
			if (processHost.platform !== "win32")
			{
				processHost.kill(0, "SIGCONT");
			}

			_request("SIGINT");
		}

		processHost.on("SIGINT", _onInterrupt);
		processHost.on("SIGTERM", _onTerminate);
		processHost.on("SIGTSTP", _onSuspend);
		child.once("error", function _rejectStart(error)
		{
			_removeListeners();
			reject(error);
		});
		child.once("close", function _resolveExit(code, signal)
		{
			_removeListeners();
			resolve(code ?? (signal ? 1 : 0));
		});
	});
}
