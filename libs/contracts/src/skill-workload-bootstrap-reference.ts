/** Prefix that marks a reference as a skill-worker bootstrap reference rather than an agent-runtime one, so the two cannot be swapped. */
const _SKILL_WORKLOAD_BOOTSTRAP_PREFIX = "skill-bootstrap-v1_";

/**
 * Build the bootstrap reference for one skill workload.
 *
 * The result is mounted into that workload's Job and nowhere else. It is not a credential: on its
 * own it grants nothing, and the server stores only its hash, so a leaked reference cannot be
 * reversed into the workload id. Store it with
 * {@link __HashSkillWorkloadBootstrapReference}, never in plain form.
 *
 * Called by: `__CreateSkillAuthoringValidationHandler` in the skills controller.
 * @param workloadId - Skill workload id; must match `[a-zA-Z0-9_-]{1,128}`.
 * @returns The prefixed reference, safe to mount into the Job.
 * @throws Error when `workloadId` contains any other character, so an unsafe id can never reach a capability reference.
 */
export async function __CreateSkillWorkloadBootstrapReference(workloadId: string): Promise<string>
{
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workloadId)) throw new Error("governed skill workload id is not safe to project into a capability reference");
	return `${_SKILL_WORKLOAD_BOOTSTRAP_PREFIX}${await _Sha256Hex(workloadId)}`;
}

/**
 * Hash a bootstrap reference so it can be stored and looked up without keeping the reference itself.
 *
 * Postgres holds only this hash. A worker presents the plain reference; the server hashes what it
 * receives and matches on the result, so a database read never yields a usable reference.
 *
 * Called by: the authoring validation worker router and its database authority.
 * @param reference - The plain bootstrap reference presented by a worker.
 * @returns Lowercase `sha256:<hex>` digest, the form stored in the database.
 */
export async function __HashSkillWorkloadBootstrapReference(reference: string): Promise<`sha256:${string}`>
{
	return `sha256:${await _Sha256Hex(reference)}`;
}

/**
 * Return whether a value looks like a skill-worker bootstrap reference.
 *
 * A shape check only — it proves nothing about whether the reference was issued or is still
 * valid. Call it to reject malformed input early, then match the hash to authorize.
 *
 * Called by: the authoring validation worker router.
 * @param value - Untrusted value from a request.
 * @returns True only for the prefix followed by 64 lowercase hex characters.
 */
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
