/**
 * Digest-string helpers shared by every package that exchanges content digests.
 */

/** The one supported digest spelling: `sha256:` followed by 64 lowercase hex characters. */
const _SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/**
 * Tests whether a string is a well-formed `sha256:<64 lowercase hex>` digest.
 *
 * A shape check only: it proves the string could be a digest, never that it matches any content.
 * Uppercase hex, another algorithm prefix, and bare hex with no prefix are all rejected, so two
 * spellings of the same hash can never both be accepted and compared as different values.
 *
 * Called by: `libs/backend/agents/execution/inputs/main/src/utils/canonical-inputs.ts`,
 * `libs/backend/agents/execution/inputs/main/src/managed-execution-identity-envelope-source.ts`.
 * @param value - Candidate digest string.
 * @returns True only for the exact accepted form.
 */
export function ___IsSha256Digest(value: string): boolean
{
	return _SHA256_DIGEST_PATTERN.test(value);
}
