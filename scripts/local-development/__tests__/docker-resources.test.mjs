import assert from "node:assert/strict";
import test from "node:test";

import { inspectOwnedDockerResource, resetOwnedPersistentState } from "../docker-resources.mjs";

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

test("ordinary reuse rejects a stale target baseline", async function _RejectStale()
{
	await assert.rejects(inspectOwnedDockerResource("volume", "postgres-volume", configuration, {
		runCommand: async function _Inspect() { return { status: 0, stdout: _labels("stale") }; }
	}), /not owned by this checkout and target baseline/u);
});

test("reset accepts a stale baseline but removes only this checkout resources", async function _ResetStale()
{
	const removals = [];
	await resetOwnedPersistentState(configuration, {
		runCommand: async function _Docker(_command, argumentsList)
		{
			if (argumentsList[1] === "inspect")
			{
				return { status: 0, stdout: _labels("stale") };
			}
			removals.push(argumentsList);
			return { status: 0, stdout: "" };
		}
	});
	assert.deepEqual(removals.map(function _Name(argumentsList) { return argumentsList.at(-1); }), ["litellm", "kurrent", "kurrent-tls-provisioner", "postgres", "network", "kurrent-tls-volume", "kurrent-volume", "postgres-volume"]);
	await assert.rejects(resetOwnedPersistentState(configuration, {
		runCommand: async function _OtherCheckout() { return { status: 0, stdout: _labels("stale", "other") }; }
	}), /not owned by this checkout/u);
});
