/** Prefix that marks a reference as a PDF-preprocessor bootstrap reference, so another workload class cannot use it. */
const _ARTIFACT_PREPROCESS_BOOTSTRAP_PREFIX = "artifact-preprocess-bootstrap-v1_";

/**
 * Builds the opaque bootstrap reference for one PDF preprocessing job.
 *
 * The controller mounts this value into the one-shot Job. It is not a credential: the worker also
 * proves its Kubernetes identity, and the server stores only the hash. A leaked reference alone
 * therefore cannot identify or run a preprocessing job.
 *
 * @param preprocessJobId - Saved preprocessing-job ID, limited to safe identifier characters.
 * @returns The prefixed reference that is safe to mount into the Job.
 * @throws Error when the job ID is not safe to project into a reference.
 */
export async function __CreateArtifactPreprocessBootstrapReference(preprocessJobId: string): Promise<string>
{
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(preprocessJobId))
		throw new Error("artifact preprocessing job id is not safe to project into a bootstrap reference");
	return `${_ARTIFACT_PREPROCESS_BOOTSTRAP_PREFIX}${await _Sha256Hex(preprocessJobId)}`;
}

/**
 * Hashes a bootstrap reference for server-side storage and lookup.
 *
 * The worker presents the plain reference and the server compares this hash, so reading the
 * database cannot recover a reference that a worker can use.
 *
 * @param reference - Plain reference received from the authenticated worker.
 * @returns The lowercase SHA-256 digest to persist and query.
 */
export async function __HashArtifactPreprocessBootstrapReference(reference: string): Promise<`sha256:${string}`>
{
	return `sha256:${await _Sha256Hex(reference)}`;
}

/**
 * Checks whether a value has the PDF-preprocessor bootstrap-reference shape.
 *
 * This only rejects malformed input. The server must still compare the stored hash and verify the
 * worker's Kubernetes identity before granting broker access.
 *
 * Called by: `__BuildArtifactPreprocessorJob`, which rejects a malformed reference before
 * projecting it into the Job.
 * @param value - Untrusted reference supplied by a worker request.
 * @returns True for the exact prefix followed by 64 lowercase hexadecimal characters.
 */
export function __IsArtifactPreprocessBootstrapReference(value: unknown): value is string
{
	return typeof value === "string" && /^artifact-preprocess-bootstrap-v1_[a-f0-9]{64}$/.test(value);
}

/** Calculates lowercase SHA-256 with browser and server Web Crypto. */
async function _Sha256Hex(value: string): Promise<string>
{
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), function _Hex(byte): string { return byte.toString(16).padStart(2, "0"); }).join("");
}
