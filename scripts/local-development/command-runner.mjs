import { spawn } from "node:child_process";

import { _SignalDevelopmentProcessTree } from "./process-group.mjs";

const _TOOLCHAIN_ENVIRONMENT_NAMES = ["COLORTERM", "DOCKER_CERT_PATH", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "FORCE_COLOR", "HOME", "LANG", "LC_ALL", "NO_COLOR", "PATH", "SHELL", "TERM", "TMPDIR"];

/** Keeps tool discovery and terminal settings without forwarding unrelated shell credentials. */
export function createLocalChildEnvironment(parentEnvironment, explicitEnvironment = {})
{
	const toolchain = Object.fromEntries(_TOOLCHAIN_ENVIRONMENT_NAMES.flatMap(function _copyAllowed(name)
	{
		return typeof parentEnvironment[name] === "string" ? [[name, parentEnvironment[name]]] : [];
	}));
	return { ...toolchain, ...explicitEnvironment };
}

/** Runs one setup command without a shell and stops its process group when the session aborts. */
export async function runLocalCommand(command, argumentsList, options = {})
{
	options.signal?.throwIfAborted();
	const processHost = options.processHost ?? process;
	const spawnProcess = options.spawnProcess ?? spawn;
	const child = spawnProcess(command, argumentsList, {
		cwd: options.cwd,
		detached: processHost.platform !== "win32",
		env: createLocalChildEnvironment(processHost.env, options.environment),
		stdio: options.inherit ? "inherit" : ["pipe", "pipe", "pipe"]
	});

	return await new Promise(function _waitForCommand(resolve, reject)
	{
		let stdout = "";
		let stderr = "";
		let settled = false;
		let forceTimer;

		function _finish(callback)
		{
			if (settled)
			{
				return;
			}

			settled = true;
			clearTimeout(forceTimer);
			options.signal?.removeEventListener("abort", _onAbort);
			callback();
		}

		function _onAbort()
		{
			_SignalDevelopmentProcessTree(child, "SIGTERM", processHost);
			forceTimer = setTimeout(function _forceStop()
			{
				_SignalDevelopmentProcessTree(child, "SIGKILL", processHost);
			}, options.shutdownGraceMilliseconds ?? 5_000);
		}

		if (!options.inherit)
		{
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", function _captureStdout(chunk) { stdout += chunk; });
			child.stderr.on("data", function _captureStderr(chunk) { stderr += chunk; });
			child.stdin.end(options.input);
		}

		options.signal?.addEventListener("abort", _onAbort, { once: true });
		child.once("error", function _rejectStart(error)
		{
			_finish(function _reject() { reject(error); });
		});
		child.once("close", function _complete(status, signal)
		{
			_finish(function _resolveOrReject()
			{
				if (options.signal?.aborted)
				{
					reject(options.signal.reason);
					return;
				}

				const result = { status, signal, stdout, stderr };

				if (status !== 0 && !options.acceptFailure)
				{
					const detail = stderr.trim() || stdout.trim() || signal || `exit ${status}`;
					reject(new Error(`${command} ${argumentsList.join(" ")} failed: ${detail}`));
					return;
				}

				resolve(result);
			});
		});
	});
}
