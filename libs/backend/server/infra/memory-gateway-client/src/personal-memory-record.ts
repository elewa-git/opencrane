import type { PersonalMemoryRecordResult } from "./memory-gateway-client.types.js";

/**
 * Thrown when the memory gateway's answer cannot be trusted as a valid response.
 *
 * Used in two places: a body that is not valid JSON (cognee-http.ts), and a search or write response
 * whose shape is unrecognised (cognee-payloads.ts and the check below). It is deliberately a failure
 * rather than an empty result — a broken contract must never look like "this subject has no facts"
 * or "the fact was stored". The message names only the check that failed, never the body.
 */
export class MemoryGatewayProtocolError extends Error
{
	/** Create an explicit protocol failure that callers must not reinterpret as an accepted fact. */
	constructor(message: string)
	{
		super(message);
		this.name = "MemoryGatewayProtocolError";
	}
}

/**
 * Check an untrusted gateway write response and return it as a typed outcome.
 *
 * Exactly two shapes are accepted: an explicit denial for a reused delivery key, or an acceptance
 * carrying the gateway's fact id and a `sha256:<64 hex chars>` digest. Anything else — a missing
 * field, an unknown outcome, a blank id, a digest in another format — is a protocol failure, so a
 * half-understood response can never be recorded as a stored fact.
 *
 * Called by: no caller in this repo yet. Only __tests__/unavailable-memory-gateway-client.test.ts
 * exercises it; it is here ready for the write path that will replace the fail-closed
 * `recordPersonalFact`.
 *
 * @param value - Parsed but untrusted gateway response body.
 * @returns `recorded` with the gateway's id and digest, or `denied` for a delivery-key conflict.
 * @throws {MemoryGatewayProtocolError} When the body is neither of those two shapes.
 */
export function __AssertPersonalMemoryRecordResult(value: unknown): PersonalMemoryRecordResult
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new MemoryGatewayProtocolError("Memory gateway returned a non-object personal-memory record response");
	const result = value as Readonly<Record<string, unknown>>;
	if (result["outcome"] === "denied")
	{
		if (result["reason"] === "idempotency_conflict") return { outcome: "denied", reason: "idempotency_conflict" };
		throw new MemoryGatewayProtocolError("Memory gateway returned an unknown personal-memory record denial");
	}
	if (result["outcome"] !== "recorded" || typeof result["idempotent"] !== "boolean" || typeof result["cogneeExternalId"] !== "string" || typeof result["contentDigest"] !== "string" || !result["cogneeExternalId"].trim() || !/^sha256:[a-f0-9]{64}$/.test(result["contentDigest"])) throw new MemoryGatewayProtocolError("Memory gateway returned invalid personal-memory record evidence");
	return { outcome: "recorded", idempotent: result["idempotent"], cogneeExternalId: result["cogneeExternalId"], contentDigest: result["contentDigest"] };
}
