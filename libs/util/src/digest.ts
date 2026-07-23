import { createHash } from "node:crypto";

import { ___CanonicalizeJson } from "./json-canonicalization.js";
import type { CanonicalJsonSha256Digest, JsonValue } from "./json-canonicalization.types.js";

/**
 * Digest-string helpers shared by every package that exchanges content digests.
 */

/** The one supported digest spelling: `sha256:` followed by 64 lowercase hex characters. */
const _SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/**
 * Tests whether a string is the canonical `sha256:<64 lowercase hex>` digest spelling.
 * Uppercase hex, other algorithms, and bare hex without the prefix all fail closed.
 * @param value - Candidate digest string.
 * @returns True only for the canonical spelling.
 */
export function ___IsSha256Digest(value: string): boolean
{
	return _SHA256_DIGEST_PATTERN.test(value);
}

/** Digest RFC 8785 canonical JSON as UTF-8 with the repository-wide SHA-256 spelling. */
export function ___DigestCanonicalJson(value: JsonValue): CanonicalJsonSha256Digest
{
	return `sha256:${createHash("sha256").update(___CanonicalizeJson(value), "utf8").digest("hex")}`;
}
