/** HTTP token characters accepted in artifact media types and unquoted parameter values. */
const _TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";

/** The media types artifact leases, receipts, and read issuance all accept. Kept in one place so a value that passes at upload cannot be rejected at read. */
const _MEDIA_TYPE = new RegExp(`^${_TOKEN}/${_TOKEN}(?:[\\t ]*;[\\t ]*${_TOKEN}=${_TOKEN})*$`, "u");

/**
 * Whether a media type is safe to echo into a `Content-Type` response header.
 *
 * Restricted to plain HTTP tokens plus token-valued parameters such as `charset=utf-8`. Quoted
 * strings, control characters, and anything that could break out of the header are refused, so a
 * caller-supplied media type cannot inject a second header.
 *
 * Called by: `libs/backend/server/agents/artifacts/main/src/artifact-read-lease.ts`; also used by
 * every lease and receipt validator in this package.
 * @param value - Candidate media type from a caller.
 * @returns True only when the value is safe to send back in a response header.
 */
export function __IsSafeArtifactMediaType(value: string): boolean
{
	return value.length <= 255 && _MEDIA_TYPE.test(value);
}
