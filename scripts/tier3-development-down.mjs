#!/usr/bin/env node

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assertTier3ResourceReplacement, inspectTier3Resources, tier3ResourceIdentity } from "./tier3-development/resource-ownership.mjs";

const _EXEC_FILE = promisify(execFile);
const _REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Deletes the retained cluster and registry after inspection proves that this worktree owns them.
 * A missing resource is already clean; an unknown or foreign owner stops cleanup before deletion.
 * @throws When ownership cannot be proved or a k3d deletion fails.
 */
export async function downTier3Resources(operations = {})
{
	const identity = tier3ResourceIdentity(_REPOSITORY_ROOT);
	const inspectResources = operations.inspectResources ?? inspectTier3Resources;
	let resources = await inspectResources(identity);
	if (resources.existingOwner === null) return;
	assertTier3ResourceReplacement(resources.existingOwner, identity.owner, true);
	const run = operations.run ?? async function _Run(command, arguments_) { await _EXEC_FILE(command, arguments_); };
	if (resources.registryExists)
	{
		resources = await inspectResources(identity);
		if (resources.existingOwner !== null)
			assertTier3ResourceReplacement(resources.existingOwner, identity.owner, true);
		if (resources.registryExists)
			await run("k3d", ["registry", "delete", identity.registryName]);
	}
	if (resources.clusterExists)
	{
		resources = await inspectResources(identity);
		if (resources.existingOwner !== null)
			assertTier3ResourceReplacement(resources.existingOwner, identity.owner, true);
		if (resources.clusterExists)
			await run("k3d", ["cluster", "delete", identity.clusterName]);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) downTier3Resources().catch(function _Failure(error) { process.stderr.write(`Tier 3 cleanup failed: ${error.message}\n`); process.exitCode = 1; });
