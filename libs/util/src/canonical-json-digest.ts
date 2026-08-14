import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { ___CanonicalizeJson } from "./json-canonicalization";
import type { CanonicalJsonSha256Digest, JsonValue } from "./json-canonicalization.types";

/**
 * SHA-256 digest of a value's RFC 8785 canonical JSON, in the `sha256:<hex>` form this repo uses.
 *
 * This is the one way to digest a JSON value in OpenCrane. Because canonicalization runs first,
 * two values that are equal as JSON always digest identically, whatever order their keys happen
 * to be in — which is what lets a stored digest detect that content changed.
 *
 * It deliberately uses a portable synchronous hash rather than Node's `crypto` or the browser's
 * asynchronous Web Crypto, so the same code and the same digest work in a server and a browser
 * bundle. Do not swap it for a runtime-specific implementation.
 *
 * Called by: `libs/models/agents/main/src/agent-revision-content.ts`,
 * `libs/models/agents/main/src/agent-tool-definition.validator.ts`,
 * `libs/backend/agents/execution/inputs/main/src/prompt-compiler.ts`,
 * `libs/backend/agents/personal/configuration/main/src/proposal/personal-configuration-proposal.ts`,
 * `libs/backend/server/conversations/main/src/db/prisma-conversation-unit-of-work.ts`.
 * @param value - JSON value to digest.
 * @returns Lowercase `sha256:<hex>` digest of the canonical JSON.
 * @throws TypeError for any input {@link ___CanonicalizeJson} rejects, so a digest is never taken over a value that could not round-trip.
 * @see https://www.rfc-editor.org/rfc/rfc8785
 * @see https://csrc.nist.gov/pubs/fips/180-4/upd1/final
 */
export function ___DigestCanonicalJson(value: JsonValue): CanonicalJsonSha256Digest
{
	return `sha256:${bytesToHex(sha256(___CanonicalizeJson(value)))}`;
}
