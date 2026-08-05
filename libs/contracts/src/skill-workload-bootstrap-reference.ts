/** Fixed protocol prefix distinguishing governed-skill worker bootstrap references from runtime references. */
const _SKILL_WORKLOAD_BOOTSTRAP_PREFIX = "skill-bootstrap-v1_";

/** Creates the opaque bootstrap reference projected only to the exact governed skill Job. */
export async function __CreateSkillWorkloadBootstrapReference(workloadId: string): Promise<string>
{
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workloadId)) throw new Error("governed skill workload id is not safe to project into a capability reference");
	return `${_SKILL_WORKLOAD_BOOTSTRAP_PREFIX}${await _Sha256Hex(workloadId)}`;
}

/** Hashes the transient bootstrap reference before it becomes a durable Postgres lookup coordinate. */
export async function __HashSkillWorkloadBootstrapReference(reference: string): Promise<`sha256:${string}`>
{
	return `sha256:${await _Sha256Hex(reference)}`;
}

/** Returns whether a value has the exact governed-skill bootstrap wire shape. */
export function __IsSkillWorkloadBootstrapReference(value: unknown): value is string
{
	return typeof value === "string" && /^skill-bootstrap-v1_[a-f0-9]{64}$/.test(value);
}

/** Calculates canonical lowercase SHA-256 with browser and server Web Crypto, never a Node-only import. */
async function _Sha256Hex(value: string): Promise<string>
{
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), function _Hex(byte): string { return byte.toString(16).padStart(2, "0"); }).join("");
}
