import crypto from "node:crypto";
import fs from "node:fs";

import { runLocalCommand } from "./command-runner.mjs";
import { LOCAL_DEVELOPMENT_PROFILES } from "./profiles.mjs";

const _RUNTIME_IMPORT_CHECK = "import cryptography, openai, pydantic_ai";

function _RequirementsDigest(requirementsPath)
{
	return crypto.createHash("sha256").update(fs.readFileSync(requirementsPath)).digest("hex");
}

function _CanImportRuntimeDependencies(pythonExecutable, runCommand)
{
	try
	{
		runCommand(pythonExecutable, ["-B", "-c", _RUNTIME_IMPORT_CHECK]);
		return true;
	}
	catch
	{
		return false;
	}
}

/** Prepare the repository-owned Python environment before Tier 2 mutates local services. */
export function prepareLocalAgentRuntimeEnvironment(configuration, runCommand = runLocalCommand)
{
	if (configuration.profile !== LOCAL_DEVELOPMENT_PROFILES.Agent)
	{
		return false;
	}

	if (!fs.existsSync(configuration.runtimePythonPath))
	{
		runCommand("python3", ["-m", "venv", configuration.runtimeVirtualEnvironmentPath], { inherit: true });
	}

	const requirementsDigest = _RequirementsDigest(configuration.runtimeRequirementsPath);
	const installedDigest = fs.existsSync(configuration.runtimeRequirementsStampPath)
		? fs.readFileSync(configuration.runtimeRequirementsStampPath, "utf8").trim()
		: "";

	if (installedDigest === requirementsDigest && _CanImportRuntimeDependencies(configuration.runtimePythonPath, runCommand))
	{
		return false;
	}

	runCommand(configuration.runtimePythonPath, [
		"-m",
		"pip",
		"install",
		"--disable-pip-version-check",
		"--requirement",
		configuration.runtimeRequirementsPath
	], { inherit: true });
	runCommand(configuration.runtimePythonPath, ["-B", "-c", _RUNTIME_IMPORT_CHECK]);
	fs.writeFileSync(configuration.runtimeRequirementsStampPath, `${requirementsDigest}\n`, { mode: 0o600 });
	return true;
}
