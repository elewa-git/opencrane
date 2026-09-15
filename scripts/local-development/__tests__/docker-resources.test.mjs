import assert from "node:assert/strict";
import test from "node:test";

import { ensureOwnedVolume, inspectOwnedDockerResource, removeOwnedDockerResource, resetOwnedPersistentState } from "../docker-resources.mjs";

const configuration = {
	baselineDigest: "current",
	kurrentContainerName: "kurrent",
	kurrentTlsProvisionerContainerName: "kurrent-tls-provisioner",
	kurrentTlsVolumeName: "kurrent-tls-volume",
	kurrentVolumeName: "kurrent-volume",
	liteLLMContainerName: "litellm",
	networkName: "network",
	postgresContainerName: "postgres",
	postgresVolumeName: "postgres-volume",
	postgresVolumeProvisionerContainerName: "postgres-volume-provisioner",
	repositoryIdentity: "repository",
	worktreeIdentity: "worktree"
};

function _labels(baseline, worktree = "worktree")
{
	return JSON.stringify({
		"opencrane.local-development.owner": "opencrane",
		"opencrane.local-development.repository": "repository",
		"opencrane.local-development.worktree": worktree,
		"opencrane.local-development.baseline": baseline
	});
}

test("container reuse reads Config.Labels and removes only its owned name", async function _RemoveOwnedContainer()
{
	const commands = [];
	async function _Docker(_command, argumentsList)
	{
		commands.push(argumentsList);

		return { status: 0, stdout: _labels("current") };
	}

	await removeOwnedDockerResource("container", "postgres", configuration, { runCommand: _Docker });
	assert.deepEqual(commands, [
		["container", "inspect", "postgres", "--format", "{{json .Config.Labels}}"],
		["container", "rm", "--force", "postgres"]
	]);
});

test("container reuse refuses a matching name from another worktree", async function _RejectOtherContainer()
{
	const commands = [];
	async function _Docker(_command, argumentsList)
	{
		commands.push(argumentsList);

		return { status: 0, stdout: _labels("current", "other") };
	}

	await assert.rejects(removeOwnedDockerResource("container", "postgres", configuration, {
		runCommand: _Docker
	}), /not owned by this checkout/u);
	assert.deepEqual(commands, [
		["container", "inspect", "postgres", "--format", "{{json .Config.Labels}}"]
	]);
});

test("volumes keep their top-level Labels format", async function _InspectVolume()
{
	async function _Docker(_command, argumentsList)
	{
		assert.deepEqual(argumentsList, [
			"volume", "inspect", "postgres-volume", "--format", "{{json .Labels}}"
		]);

		return { status: 0, stdout: _labels("current") };
	}

	assert.equal(await inspectOwnedDockerResource("volume", "postgres-volume", configuration, {
		runCommand: _Docker
	}), true);
});

test("ordinary reuse rejects a stale target baseline", async function _RejectStale()
{
	async function _Inspect()
	{
		return { status: 0, stdout: _labels("stale") };
	}

	await assert.rejects(inspectOwnedDockerResource("volume", "postgres-volume", configuration, {
		runCommand: _Inspect,
	}), /not owned by this checkout and target baseline/u);
});

test("a PostgreSQL volume from another worktree is refused before provisioning", async function _ForeignVolume()
{
	const commands = [];
	async function _Docker(_command, argumentsList)
	{
		commands.push(argumentsList);

		return { status: 0, stdout: _labels("current", "other") };
	}

	await assert.rejects(ensureOwnedVolume("postgres-volume", configuration, { runCommand: _Docker }), /not owned by this checkout/u);
	assert.deepEqual(commands, [
		["volume", "inspect", "postgres-volume", "--format", "{{json .Labels}}"]
	]);
});

test("reset accepts a stale baseline but removes only this checkout resources", async function _ResetStale()
{
	const removals = [];
	async function _Docker(_command, argumentsList)
	{
		if (argumentsList[1] === "inspect")
		{
			return { status: 0, stdout: _labels("stale") };
		}

		removals.push(argumentsList);

		return { status: 0, stdout: "" };
	}

	await resetOwnedPersistentState(configuration, {
		runCommand: _Docker,
	});
	assert.deepEqual(removals.map((argumentsList) => argumentsList.at(-1)), [
		"litellm",
		"kurrent",
		"kurrent-tls-provisioner",
		"postgres",
		"postgres-volume-provisioner",
		"network",
		"kurrent-tls-volume",
		"kurrent-volume",
		"postgres-volume",
	]);

	async function _OtherCheckout()
	{
		return { status: 0, stdout: _labels("stale", "other") };
	}

	await assert.rejects(resetOwnedPersistentState(configuration, {
		runCommand: _OtherCheckout,
	}), /not owned by this checkout/u);
});
