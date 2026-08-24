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

function _ensureOwnedNetwork(networkName)
{
	const result = runLocalCommand("docker", [
		"network",
		"inspect",
		networkName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true });

	if (result.status !== 0)
	{
		runLocalCommand("docker", ["network", "create", "--label", `${_OWNER_LABEL_KEY}=${_OWNER_LABEL_VALUE}`, networkName]);
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Network ${networkName} exists but is not owned by OpenCrane local development`);
	}
}

function _connectOwnedContainerToNetwork(containerName, networkName)
{
	const state = inspectOwnedContainer(containerName);

	if (!state.exists)
	{
		throw new Error(`Owned container ${containerName} must exist before it can join ${networkName}`);
	}

	const result = runLocalCommand("docker", [
		"container",
		"inspect",
		containerName,
		"--format",
		"{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}"
	]);
	const networks = result.stdout.split("\n").map(function _trim(name) { return name.trim(); });

	if (!networks.includes(networkName))
	{
		runLocalCommand("docker", ["network", "connect", networkName, containerName]);
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

function _removeOwnedNetwork(networkName)
{
	const result = runLocalCommand("docker", [
		"network",
		"inspect",
		networkName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true });

	if (result.status !== 0)
	{
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Network ${networkName} exists but is not owned by OpenCrane local development`);
	}

	runLocalCommand("docker", ["network", "rm", networkName]);
}

export function resetLocalDevelopmentContainers(configuration)
{
	_removeOwnedContainer(configuration.liteLLMContainerName);
	_removeOwnedContainer(configuration.postgresContainerName);
	_removeOwnedVolume(configuration.postgresVolumeName);
	_removeOwnedNetwork(configuration.localNetworkName);
}

export async function startLocalLiteLLM(configuration, secrets)
{
	_removeOwnedContainer(configuration.liteLLMContainerName);
	_ensureOwnedNetwork(configuration.localNetworkName);
	_connectOwnedContainerToNetwork(configuration.postgresContainerName, configuration.localNetworkName);
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
