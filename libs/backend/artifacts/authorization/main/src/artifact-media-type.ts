/** HTTP token characters accepted in artifact media types and unquoted parameter values. */
const _TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";

/** Safe media-type grammar shared by artifact leases, receipts, and catalogue read issuance. */
const _MEDIA_TYPE = new RegExp(`^${_TOKEN}/${_TOKEN}(?:[\\t ]*;[\\t ]*${_TOKEN}=${_TOKEN})*$`, "u");

/** Accept a bounded response-safe media type, including token-valued parameters such as charset. */
export function __IsSafeArtifactMediaType(value: string): boolean
{
	return value.length <= 255 && _MEDIA_TYPE.test(value);
}
