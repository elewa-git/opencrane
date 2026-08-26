import { spawn } from "node:child_process";

import { createToolchainProcessEnvironment } from "./process-environments.mjs";

/**
 * Runs one setup command asynchronously so the coordinator can still react to a shutdown request.
 * Aborting asks the child to terminate and rejects with the abort reason after the child closes.
 *
 * @param {string} command - Executable name or path.
 * @param {readonly string[]} argumentsList - Arguments passed without shell expansion.
 * @param {{ cwd?: string, environment?: Record<string, string>, input?: string | Buffer, inherit?: boolean, acceptFailure?: boolean, signal?: AbortSignal, spawnProcess?: typeof spawn }} options - Process and failure handling options.
 * @returns {Promise<{ status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>} Completed process result.
 * @throws Rejects when the process cannot start, is aborted, or exits unsuccessfully without `acceptFailure`.
 */
export async function runLocalCommand(command, argumentsList, options = {})
{
	options.signal?.throwIfAborted();
	const spawnProcess = options.spawnProcess ?? spawn;
	const child = spawnProcess(command, argumentsList, {
		cwd: options.cwd,
		env: createToolchainProcessEnvironment(process.env, options.environment),
		stdio: options.inherit ? "inherit" : ["pipe", "pipe", "pipe"]
	});

	return new Promise(function _waitForCommand(resolve, reject)
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
			child.kill("SIGTERM");
			forceTimer = setTimeout(function _forceStop() { child.kill("SIGKILL"); }, 5_000);
		}

		if (!options.inherit)
		{
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", function _readStdout(chunk) { stdout += chunk; });
			child.stderr.on("data", function _readStderr(chunk) { stderr += chunk; });
			child.stdin.end(options.input);
		}

		options.signal?.addEventListener("abort", _onAbort, { once: true });
		child.once("error", function _onError(error)
		{
			_finish(function _rejectStart() { reject(error); });
		});
		child.once("close", function _onClose(status, signal)
		{
			_finish(function _completeCommand()
			{
				if (options.signal?.aborted)
				{
					reject(options.signal.reason);
					return;
				}

				const result = { status, signal, stdout, stderr };

				if (status !== 0 && !options.acceptFailure)
				{
					const detail = stderr.trim() || stdout.trim() || (signal ? `signal ${signal}` : `exit ${status}`);
					reject(new Error(`${command} ${argumentsList.join(" ")} failed: ${detail}`));
					return;
				}

				resolve(result);
			});
		});
	});
}

/**
 * Runs a coordinator-built command while forwarding its environment and session shutdown signal.
 * This keeps command assembly separate from the process lifecycle handled by {@link runLocalCommand}.
 *
 * @param {{ command: string, arguments: readonly string[], environment?: Record<string, string> }} specification - Command assembled by the Tier 2 coordinator.
 * @param {{ cwd?: string, inherit?: boolean, signal?: AbortSignal }} options - Working directory, output choice, and lifecycle cancellation.
 * @returns {Promise<{ status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string }>} Completed process result.
 * @throws Rejects with the same start, shutdown, or exit failure as {@link runLocalCommand}.
 */
export async function runLocalCommandSpecification(specification, options = {})
{
	return await runLocalCommand(specification.command, specification.arguments, {
		cwd: options.cwd,
		environment: specification.environment,
		inherit: options.inherit,
		signal: options.signal
	});
}
