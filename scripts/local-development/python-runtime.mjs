import crypto from "node:crypto";
import fs from "node:fs";

import { runLocalCommand } from "./command-runner.mjs";
import { LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";

const _RUNTIME_IMPORT_CHECK = "import cryptography, openai, pydantic_ai";

function _RequirementsDigest(requirementsPath)
{
	return crypto.createHash("sha256").update(fs.readFileSync(requirementsPath)).digest("hex");
}

async function _CanImportRuntimeDependencies(pythonExecutable, runCommand, signal)
{
	try
	{
		await runCommand(pythonExecutable, ["-B", "-c", _RUNTIME_IMPORT_CHECK], { signal });
		return true;
	}
	catch
	{
		return false;
	}
}

/**
 * Prepares the repository-owned Python environment before Tier 2 mutates local services.
 * Core skips Python; Agent profiles run the pinned install only when the requirements digest changed
 * or the existing environment cannot import the runtime dependencies.
 *
 * @throws Rejects when Python setup fails or the session stops.
 */
export async function prepareLocalAgentRuntimeEnvironment(configuration, runCommand = runLocalCommand)
{
	if (configuration.profile !== LOCAL_DEVELOPMENT_PROFILES.Agent)
	{
		return;
	}

	if (!fs.existsSync(configuration.runtimePythonPath))
	{
		await runCommand("python3", ["-m", "venv", configuration.runtimeVirtualEnvironmentPath], { inherit: true, signal: configuration.abortSignal });
	}

	const requirementsDigest = _RequirementsDigest(configuration.runtimeRequirementsPath);
	const installedDigest = fs.existsSync(configuration.runtimeRequirementsStampPath)
		? fs.readFileSync(configuration.runtimeRequirementsStampPath, "utf8").trim()
		: "";

	if (installedDigest === requirementsDigest && await _CanImportRuntimeDependencies(configuration.runtimePythonPath, runCommand, configuration.abortSignal))
	{
		return;
	}

	await runCommand(configuration.runtimePythonPath, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--requirement",
		configuration.runtimeRequirementsPath
	], { inherit: true, signal: configuration.abortSignal });
	await runCommand(configuration.runtimePythonPath, ["-B", "-c", _RUNTIME_IMPORT_CHECK], { signal: configuration.abortSignal });
	fs.writeFileSync(configuration.runtimeRequirementsStampPath, `${requirementsDigest}\n`, { mode: 0o600 });
}
