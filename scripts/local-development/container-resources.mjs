import { createLiteLLMRunCommand } from "./commands.mjs";
import { runLocalCommand, runLocalCommandSpecification } from "./command-runner.mjs";

const _OWNER_LABEL_KEY = "opencrane.local-development.owner";
const _OWNER_LABEL_VALUE = "opencrane";

export function inspectOwnedContainer(containerName)
{
	const result = runLocalCommand("docker", [
		"container",
		"inspect",
		containerName,
		"--format",
		`{{ index .Config.Labels "${_OWNER_LABEL_KEY}" }}|{{.State.Running}}`
	], { acceptFailure: true });

	if (result.status !== 0)
	{
		return { exists: false, running: false };
	}

	const [owner, running] = result.stdout.trim().split("|");

	if (owner !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Container ${containerName} exists but is not owned by OpenCrane local development`);
	}

	return {
		exists: true,
		running: running === "true"
	};
}

export function ensureOwnedVolume(volumeName)
{
	const result = runLocalCommand("docker", [
		"volume",
		"inspect",
		volumeName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true });

	if (result.status !== 0)
	{
		runLocalCommand("docker", ["volume", "create", "--label", `${_OWNER_LABEL_KEY}=${_OWNER_LABEL_VALUE}`, volumeName]);
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Volume ${volumeName} exists but is not owned by OpenCrane local development`);
	}
}

function _removeOwnedContainer(containerName)
{
	const state = inspectOwnedContainer(containerName);

	if (state.exists)
	{
		runLocalCommand("docker", ["rm", "--force", containerName]);
	}
}

function _removeOwnedVolume(volumeName)
{
	const result = runLocalCommand("docker", [
		"volume",
		"inspect",
		volumeName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true });

	if (result.status !== 0)
	{
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Volume ${volumeName} exists but is not owned by OpenCrane local development`);
	}

	runLocalCommand("docker", ["volume", "rm", volumeName]);
}

export function resetLocalDevelopmentContainers(configuration)
{
	_removeOwnedContainer(configuration.liteLLMContainerName);
	_removeOwnedContainer(configuration.postgresContainerName);
	_removeOwnedVolume(configuration.postgresVolumeName);
}

export async function startLocalLiteLLM(configuration, secrets)
{
	_removeOwnedContainer(configuration.liteLLMContainerName);
	const specification = createLiteLLMRunCommand(configuration, secrets);
	runLocalCommandSpecification(specification);
	return true;
}

export function stopOwnedContainer(containerName)
{
	const state = inspectOwnedContainer(containerName);

	if (state.exists && state.running)
	{
		runLocalCommand("docker", ["stop", "--time", "5", containerName], { acceptFailure: true });
	}
}
