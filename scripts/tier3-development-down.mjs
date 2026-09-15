#!/usr/bin/env node

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assertTier3ResourceReplacement, inspectTier3Resources, tier3ResourceIdentity } from "./tier3-development/resource-ownership.mjs";

const _EXEC_FILE = promisify(execFile);
const _REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const _SMOKE_PATH = fileURLToPath(new URL("../apps/_infra/deploy-k8s/platform/tests/develop-smoke.sh", import.meta.url));

/**
 * Deletes the retained cluster and registry only after the smoke's full k3d node/volume guard
 * proves this worktree owns the complete deletion set. It then removes only owner-scoped smoke
 * image refs; an orphan or foreign object stops cleanup before a destructive command.
 * @throws When ownership cannot be proved or a k3d deletion fails.
 */
export async function downTier3Resources(operations = {})
{
	const identity = tier3ResourceIdentity(_REPOSITORY_ROOT);
	const inspectResources = operations.inspectResources ?? inspectTier3Resources;
	const guard = operations.guard ?? _AssertOwnedResources;
	const pruneImages = operations.pruneImages ?? _PruneOwnedImages;
	await guard(identity);
	let resources = await inspectResources(identity);
	if (resources.existingOwner !== null) assertTier3ResourceReplacement(resources.existingOwner, identity.owner, true);
	const run = operations.run ?? async function _Run(command, arguments_) { await _EXEC_FILE(command, arguments_); };
	if (resources.registryExists)
	{
		await guard(identity);
		resources = await inspectResources(identity);
		if (resources.existingOwner !== null)
			assertTier3ResourceReplacement(resources.existingOwner, identity.owner, true);
		if (resources.registryExists)
			await run("k3d", ["registry", "delete", identity.registryName]);
	}
	if (resources.clusterExists)
	{
		await guard(identity);
		resources = await inspectResources(identity);
		if (resources.existingOwner !== null)
			assertTier3ResourceReplacement(resources.existingOwner, identity.owner, true);
		if (resources.clusterExists)
			await run("k3d", ["cluster", "delete", identity.clusterName]);
	}
	await pruneImages(identity);
}

/** Checks the exact k3d deletion set using the smoke's shared read-only proof. */
async function _AssertOwnedResources(identity) { await _RunSmokeOwnershipMode(identity, "--assert-owned-resources"); }

/** Removes only smoke image refs and layers of this worktree after its cluster is gone. */
async function _PruneOwnedImages(identity) { await _RunSmokeOwnershipMode(identity, "--prune-owned-images"); }

async function _RunSmokeOwnershipMode(identity, mode)
{
	const environment = {
		...process.env,
		CLUSTER_NAME: identity.clusterName,
		SMOKE_RESOURCE_OWNER: identity.owner,
	};
	await _EXEC_FILE("bash", [_SMOKE_PATH, mode], { env: environment });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) downTier3Resources().catch(function _Failure(error) { process.stderr.write(`Tier 3 cleanup failed: ${error.message}\n`); process.exitCode = 1; });
