import type { CanonicalJsonSha256Digest } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

/**
 * Gives authorization callers a domain-named wrapper over the shared canonical JSON digest.
 * @param value - JSON value whose exact canonical content is being bound.
 * @returns Digest encoded as `sha256:` followed by 64 lowercase hexadecimal characters.
 */
export function __DigestCanonicalJson(value: JsonValue): CanonicalJsonSha256Digest
{
	return ___DigestCanonicalJson(value);
}
