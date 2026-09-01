import { createLiteLLMRunCommand } from "./commands.mjs";
import { runLocalCommand, runLocalCommandSpecification } from "./command-runner.mjs";

const _OWNER_LABEL_KEY = "opencrane.local-development.owner";
const _OWNER_LABEL_VALUE = "opencrane";

/**
 * Reads a container only after confirming its local-development ownership label.
 * A missing container is reported as absent, while a matching name owned by another process is rejected.
 *
 * @param {string} containerName - Docker name to inspect.
 * @param {AbortSignal} signal - Session shutdown signal forwarded to Docker.
 * @returns {{ exists: boolean, running: boolean }} Whether the owned container exists and is running.
 * @throws Rejects when the name belongs to a container outside this coordinator.
 */
export async function inspectOwnedContainer(containerName, signal)
{
	const result = await runLocalCommand("docker", [
		"container",
		"inspect",
		containerName,
		"--format",
		`{{ index .Config.Labels "${_OWNER_LABEL_KEY}" }}|{{.State.Running}}`
	], { acceptFailure: true, signal });

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

/**
 * Creates the labelled PostgreSQL volume or reuses it after confirming coordinator ownership.
 * Reuse preserves Tier 2 data between sessions without accepting an unrelated volume with the same name.
 */
export async function ensureOwnedVolume(volumeName, signal)
{
	const result = await runLocalCommand("docker", [
		"volume",
		"inspect",
		volumeName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true, signal });

	if (result.status !== 0)
	{
		await runLocalCommand("docker", ["volume", "create", "--label", `${_OWNER_LABEL_KEY}=${_OWNER_LABEL_VALUE}`, volumeName], { signal });
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Volume ${volumeName} exists but is not owned by OpenCrane local development`);
	}
}

async function _ensureOwnedNetwork(networkName, signal)
{
	const result = await runLocalCommand("docker", [
		"network",
		"inspect",
		networkName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true, signal });

	if (result.status !== 0)
	{
		await runLocalCommand("docker", ["network", "create", "--label", `${_OWNER_LABEL_KEY}=${_OWNER_LABEL_VALUE}`, networkName], { signal });
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Network ${networkName} exists but is not owned by OpenCrane local development`);
	}
}

async function _connectOwnedContainerToNetwork(containerName, networkName, signal)
{
	const state = await inspectOwnedContainer(containerName, signal);

	if (!state.exists)
	{
		throw new Error(`Owned container ${containerName} must exist before it can join ${networkName}`);
	}

	const result = await runLocalCommand("docker", [
		"container",
		"inspect",
		containerName,
		"--format",
		"{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}"
	], { signal });
	const networks = result.stdout.split("\n").map(function _trim(name) { return name.trim(); });

	if (!networks.includes(networkName))
	{
		await runLocalCommand("docker", ["network", "connect", networkName, containerName], { signal });
	}
}

/**
 * Removes a container after {@link inspectOwnedContainer} confirms coordinator ownership.
 * A missing container needs no cleanup and returns successfully.
 */
export async function removeOwnedContainer(containerName, signal)
{
	const state = await inspectOwnedContainer(containerName, signal);

	if (state.exists)
	{
		await runLocalCommand("docker", ["rm", "--force", containerName], { signal });
	}
}

async function _removeOwnedVolume(volumeName, signal)
{
	const result = await runLocalCommand("docker", [
		"volume",
		"inspect",
		volumeName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true, signal });

	if (result.status !== 0)
	{
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Volume ${volumeName} exists but is not owned by OpenCrane local development`);
	}

	await runLocalCommand("docker", ["volume", "rm", volumeName], { signal });
}

async function _removeOwnedNetwork(networkName, signal)
{
	const result = await runLocalCommand("docker", [
		"network",
		"inspect",
		networkName,
		"--format",
		`{{ index .Labels "${_OWNER_LABEL_KEY}" }}`
	], { acceptFailure: true, signal });

	if (result.status !== 0)
	{
		return;
	}

	if (result.stdout.trim() !== _OWNER_LABEL_VALUE)
	{
		throw new Error(`Network ${networkName} exists but is not owned by OpenCrane local development`);
	}

	await runLocalCommand("docker", ["network", "rm", networkName], { signal });
}

/**
 * Removes the labelled Tier 2 containers, network, and PostgreSQL volume selected by `--reset`.
 * Each ownership check prevents reset from deleting a same-named Docker resource created elsewhere.
 */
export async function resetLocalDevelopmentContainers(configuration)
{
	await removeOwnedContainer(configuration.liteLLMContainerName, configuration.abortSignal);
	await removeOwnedContainer(configuration.postgresContainerName, configuration.abortSignal);
	await _removeOwnedVolume(configuration.postgresVolumeName, configuration.abortSignal);
	await _removeOwnedNetwork(configuration.localNetworkName, configuration.abortSignal);
}

/**
 * Starts Alternative A's LiteLLM container on the network shared with its PostgreSQL database.
 * A failed or aborted start removes the attempted container so the coordinator does not leave it running.
 *
 * @returns {Promise<true>} Tells the coordinator that it owns a LiteLLM container to remove at shutdown.
 */
export async function startLocalLiteLLM(configuration, secrets)
{
	let startAttempted = false;

	try
	{
		await removeOwnedContainer(configuration.liteLLMContainerName, configuration.abortSignal);
		await _ensureOwnedNetwork(configuration.localNetworkName, configuration.abortSignal);
		await _connectOwnedContainerToNetwork(configuration.postgresContainerName, configuration.localNetworkName, configuration.abortSignal);
		const specification = createLiteLLMRunCommand(configuration, secrets);
		startAttempted = true;
		await runLocalCommandSpecification(specification, { signal: configuration.abortSignal });
		configuration.abortSignal?.throwIfAborted();
		return true;
	}
	catch (error)
	{
		if (startAttempted)
		{
			await removeOwnedContainer(configuration.liteLLMContainerName);
		}

		throw error;
	}
}

/**
 * Stops a running container after {@link inspectOwnedContainer} confirms coordinator ownership.
 * Missing or already stopped containers need no cleanup; Docker stop failures are tolerated during teardown.
 */
export async function stopOwnedContainer(containerName)
{
	const state = await inspectOwnedContainer(containerName);

	if (state.exists && state.running)
	{
		await runLocalCommand("docker", ["stop", "--time", "5", containerName], { acceptFailure: true });
	}
}
