import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { ___CanonicalizeJson } from "./json-canonicalization.js";
import type { CanonicalJsonSha256Digest, JsonValue } from "./json-canonicalization.types.js";

/**
 * Hashes RFC 8785 canonical JSON with SHA-256 and returns the platform's canonical digest spelling.
 *
 * This intentionally uses one synchronous, environment-neutral implementation rather than Node's
 * `crypto` module or the browser's asynchronous Web Crypto API. Callers can therefore bind the same
 * canonical bytes in Node and browser bundles without changing the digest contract or choosing a
 * runtime-specific algorithm.
 *
 * @param value - JSON value whose canonical UTF-8 representation is hashed.
 * @returns Lowercase `sha256:<hex>` digest of the RFC 8785 canonical JSON representation.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 * @see https://csrc.nist.gov/pubs/fips/180-4/upd1/final
 */
export function ___DigestCanonicalJson(value: JsonValue): CanonicalJsonSha256Digest
{
	return `sha256:${bytesToHex(sha256(___CanonicalizeJson(value)))}`;
}
