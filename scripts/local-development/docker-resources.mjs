import { runLocalCommand } from "./command-runner.mjs";

const _LABELS = Object.freeze({
	owner: "opencrane.local-development.owner",
	repository: "opencrane.local-development.repository",
	worktree: "opencrane.local-development.worktree",
	baseline: "opencrane.local-development.baseline"
});

/** Returns the complete identity attached to every Tier 2 Docker resource. */
function _expectedLabels(configuration)
{
	return {
		[_LABELS.owner]: "opencrane",
		[_LABELS.repository]: configuration.repositoryIdentity,
		[_LABELS.worktree]: configuration.worktreeIdentity,
		[_LABELS.baseline]: configuration.baselineDigest
	};
}

/** Produces Docker label arguments from this checkout and target baseline. */
export function createDockerLabelArguments(configuration)
{
	return Object.entries(_expectedLabels(configuration)).flatMap(function _toLabel([name, value])
	{
		return ["--label", `${name}=${value}`];
	});
}

/** Returns a resource only when its repository, worktree, and target-baseline labels still match. */
export async function inspectOwnedDockerResource(kind, name, configuration, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	const result = await runCommand("docker", [kind, "inspect", name, "--format", "{{json .Labels}}"], {
		acceptFailure: true,
		signal: operations.signal
	});
	if (result.status !== 0)
	{
		return false;
	}

	let labels;
	try
	{
		labels = JSON.parse(result.stdout.trim());
	}
	catch
	{
		throw new Error(`Docker ${kind} ${name} returned invalid ownership labels`);
	}
	for (const [label, expected] of Object.entries(_expectedLabels(configuration)))
	{
		if (label === _LABELS.baseline && operations.allowBaselineMismatch)
		{
			continue;
		}
		if (labels?.[label] !== expected)
		{
			throw new Error(`Docker ${kind} ${name} is not owned by this checkout and target baseline`);
		}
	}
	return true;
}

/** Creates a persistent volume with this checkout's ownership labels, or validates an existing match. */
export async function ensureOwnedVolume(name, configuration, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	if (!await inspectOwnedDockerResource("volume", name, configuration, operations))
	{
		await runCommand("docker", ["volume", "create", ...createDockerLabelArguments(configuration), name], { signal: operations.signal });
	}
}

/** Creates a session network with this checkout's ownership labels, or validates an existing match. */
export async function ensureOwnedNetwork(configuration, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	if (!await inspectOwnedDockerResource("network", configuration.networkName, configuration, operations))
	{
		await runCommand("docker", ["network", "create", ...createDockerLabelArguments(configuration), configuration.networkName], { signal: operations.signal });
	}
}

/** Removes a resource after its ownership labels match, while leaving missing resources untouched. */
export async function removeOwnedDockerResource(kind, name, configuration, operations = {})
{
	const runCommand = operations.runCommand ?? runLocalCommand;
	if (!await inspectOwnedDockerResource(kind, name, configuration, operations))
	{
		return;
	}
	const argumentsList = kind === "container" ? [kind, "rm", "--force", name] : [kind, "rm", name];
	await runCommand("docker", argumentsList, { signal: operations.signal });
}

/** Removes both fresh-install stores after their labelled containers, network, and TLS volume. */
export async function resetOwnedPersistentState(configuration, operations = {})
{
	const resetOperations = { ...operations, allowBaselineMismatch: true };
	await removeOwnedDockerResource("container", configuration.liteLLMContainerName, configuration, resetOperations);
	await removeOwnedDockerResource("container", configuration.kurrentContainerName, configuration, resetOperations);
	await removeOwnedDockerResource("container", configuration.kurrentTlsProvisionerContainerName, configuration, resetOperations);
	await removeOwnedDockerResource("container", configuration.postgresContainerName, configuration, resetOperations);
	await removeOwnedDockerResource("network", configuration.networkName, configuration, resetOperations);
	await removeOwnedDockerResource("volume", configuration.kurrentTlsVolumeName, configuration, resetOperations);
	await removeOwnedDockerResource("volume", configuration.kurrentVolumeName, configuration, resetOperations);
	await removeOwnedDockerResource("volume", configuration.postgresVolumeName, configuration, resetOperations);
}
