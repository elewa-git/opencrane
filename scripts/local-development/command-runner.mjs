import { spawnSync } from "node:child_process";

import { createToolchainProcessEnvironment } from "./process-environments.mjs";

/**
 * Runs one setup command synchronously so later Tier 2 steps cannot start before it succeeds.
 * @param {string} command - Executable name or path.
 * @param {readonly string[]} argumentsList - Arguments passed without shell expansion.
 * @param {{ cwd?: string, environment?: Record<string, string>, input?: string | Buffer, inherit?: boolean, acceptFailure?: boolean }} options - Process and failure handling options.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Completed process result.
 * @throws When the process cannot start or exits unsuccessfully without `acceptFailure`.
 */
export function runLocalCommand(command, argumentsList, options = {})
{
	const result = spawnSync(command, argumentsList, {
		cwd: options.cwd,
		env: createToolchainProcessEnvironment(process.env, options.environment),
		encoding: "utf8",
		input: options.input,
		stdio: options.inherit ? "inherit" : "pipe"
	});

	if (result.error)
	{
		throw result.error;
	}

	if (result.status !== 0 && !options.acceptFailure)
	{
		const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
		throw new Error(`${command} ${argumentsList.join(" ")} failed: ${detail}`);
	}

	return result;
}

/**
 * Runs a reviewed command specification through {@link runLocalCommand}.
 * @param {{ command: string, arguments: readonly string[], environment?: Record<string, string> }} specification - Command assembled by the Tier 2 coordinator.
 * @param {{ cwd?: string, inherit?: boolean }} options - Working directory and output choice.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Completed process result.
 */
export function runLocalCommandSpecification(specification, options = {})
{
	return runLocalCommand(specification.command, specification.arguments, {
		cwd: options.cwd,
		environment: specification.environment,
		inherit: options.inherit
	});
}
