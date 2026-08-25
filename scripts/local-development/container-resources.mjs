import { createLiteLLMRunCommand } from "./commands.mjs";
import { runLocalCommand, runLocalCommandSpecification } from "./command-runner.mjs";

const _OWNER_LABEL_KEY = "opencrane.local-development.owner";
const _OWNER_LABEL_VALUE = "opencrane";

/**
 * Reads a container only after confirming its local-development ownership label.
 * @returns {{ exists: boolean, running: boolean }} Whether the owned container exists and is running.
 * @throws When the name belongs to a container outside this coordinator.
 */
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

/** Creates the labelled PostgreSQL volume or accepts the existing owned volume. */
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

export function removeOwnedContainer(containerName)
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

/** Removes the labelled Tier 2 containers, network, and PostgreSQL volume selected by `--reset`. */
export function resetLocalDevelopmentContainers(configuration)
{
	removeOwnedContainer(configuration.liteLLMContainerName);
	removeOwnedContainer(configuration.postgresContainerName);
	_removeOwnedVolume(configuration.postgresVolumeName);
	_removeOwnedNetwork(configuration.localNetworkName);
}

/** Starts Alternative A's LiteLLM container on the network shared with its PostgreSQL database. */
export async function startLocalLiteLLM(configuration, secrets)
{
	removeOwnedContainer(configuration.liteLLMContainerName);
	_ensureOwnedNetwork(configuration.localNetworkName);
	_connectOwnedContainerToNetwork(configuration.postgresContainerName, configuration.localNetworkName);
	const specification = createLiteLLMRunCommand(configuration, secrets);
	runLocalCommandSpecification(specification);
	return true;
}

/** Stops a running container after {@link inspectOwnedContainer} confirms coordinator ownership. */
export function stopOwnedContainer(containerName)
{
	const state = inspectOwnedContainer(containerName);

	if (state.exists && state.running)
	{
		runLocalCommand("docker", ["stop", "--time", "5", containerName], { acceptFailure: true });
	}
}
