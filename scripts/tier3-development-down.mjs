#!/usr/bin/env node

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { assertTier3ResourceReplacement, inspectTier3Resources, tier3ResourceIdentity } from "./tier3-development/resource-ownership.mjs";

const _EXEC_FILE = promisify(execFile);
const _REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Delete only k3d resources whose owner label matches this worktree. */
export async function downTier3Resources(operations = {})
{
	const identity = tier3ResourceIdentity(_REPOSITORY_ROOT);
	const resources = await (operations.inspectResources ?? inspectTier3Resources)(identity);
	if (resources.existingOwner === null) return;
	assertTier3ResourceReplacement(resources.existingOwner, identity.owner, true);
	const run = operations.run ?? async function _Run(command, arguments_) { try { await _EXEC_FILE(command, arguments_); } catch (error) { if (error.code !== 1) throw error; } };
	await run("k3d", ["cluster", "delete", identity.clusterName]);
	await run("k3d", ["registry", "delete", identity.registryName]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) downTier3Resources().catch(function _Failure(error) { process.stderr.write(`Tier 3 cleanup failed: ${error.message}\n`); process.exitCode = 1; });
