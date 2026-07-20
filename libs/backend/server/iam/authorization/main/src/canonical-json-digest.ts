import { createHash } from "node:crypto";

import type { CanonicalJsonSha256Digest } from "@opencrane/models/authorization";
import { ___CanonicalizeJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

/**
 * Digests RFC 8785 canonical JSON as UTF-8 bytes with backend-owned SHA-256.
 * @param value - JSON value whose exact canonical content is being bound.
 * @returns Digest encoded as `sha256:` followed by 64 lowercase hexadecimal characters.
 */
export function __DigestCanonicalJson(value: JsonValue): CanonicalJsonSha256Digest
{
	const canonicalJson = ___CanonicalizeJson(value);
	return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}
