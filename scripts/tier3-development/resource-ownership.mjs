import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";

const _EXEC_FILE = promisify(execFile);
const TIER3_OWNER_LABEL = "opencrane.tier3.owner";

/** Derive stable, DNS-safe resource coordinates from the exact worktree path. */
export function tier3ResourceIdentity(repositoryRoot)
{
	const worktree = realpathSync(repositoryRoot);
	const digest = createHash("sha256").update(worktree).digest("hex").slice(0, 10);
	const owner = `worktree-${digest}`;
	return Object.freeze({ clusterName: `opencrane-tier3-${digest}`, clusterTenant: `tier3-${digest}`, ingressPort: 20_000 + Number.parseInt(digest.slice(0, 4), 16) % 30_000, namespace: `opencrane-tier3-${digest}`, owner, registryName: `opencrane-tier3-${digest}-registry`, releaseName: `opencrane-tier3-${digest}`, worktree });
}

/** Read exact owner labels from the cluster server and registry containers. */
export async function inspectTier3Resources(identity, operations = {})
{
	const inspect = operations.inspect ?? function _InspectResource(name) { return _Inspect(name, operations.execFile ?? _EXEC_FILE); };
	const cluster = await inspect(`k3d-${identity.clusterName}-server-0`);
	const registry = await inspect(`k3d-${identity.registryName}`);
	if (!cluster.exists && !registry.exists) return { clusterExists: false, existingOwner: null, registryExists: false };
	if (!cluster.exists && registry.exists) return { clusterExists: false, existingOwner: "unknown", registryExists: true };
	const registryAssociated = !registry.exists || registry.networks.includes(`k3d-${identity.clusterName}`);
	return { clusterExists: true, existingOwner: registryAssociated ? cluster.owner ?? "unknown" : "unknown", registryExists: registry.exists };
}

/** Refuse implicit replacement and every resource not proven to belong to this worktree. */
export function assertTier3ResourceReplacement(existingOwner, expectedOwner, replaceOwned)
{
	if (existingOwner === null) return;
	if (existingOwner !== expectedOwner) throw new Error(`Tier 3 resource collision: expected owner ${expectedOwner}, found ${existingOwner}.`);
	if (!replaceOwned) throw new Error("This worktree already owns retained Tier 3 resources; rerun with --replace-owned or run npm run dev:tier3:down.");
}

async function _Inspect(name, execFile)
{
	try
	{
		const result = await execFile("docker", ["inspect", name]);
		const inspected = JSON.parse(result.stdout)[0];
		return { exists: true, networks: Object.keys(inspected.NetworkSettings?.Networks ?? {}), owner: inspected.Config?.Labels?.[TIER3_OWNER_LABEL] ?? null };
	}
	catch (error)
	{
		if (error.code === 1 && /No such object:/u.test(error.stderr ?? "")) return { exists: false, owner: null };
		throw error;
	}
}
