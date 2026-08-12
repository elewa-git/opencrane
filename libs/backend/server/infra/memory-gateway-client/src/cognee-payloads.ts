import { MemoryGatewayProtocolError } from "./personal-memory-record.js";
import type { MemoryFact, MemoryProvenance, ScopedMemoryFact } from "./memory-gateway-client.types.js";

/** Version number written into each stored scoped record, so its provenance can be read back safely. A record with any other version is dropped on decode. */
const _SCOPED_ENVELOPE_VERSION = 1;

/** Return a plain object suitable for security-boundary parsing. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Return whether an untrusted value is a non-blank string. */
function _IsText(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decode one stored scoped envelope, returning null when it cannot prove complete provenance.
 *
 * A record that fails validation is DROPPED by the caller rather than surfaced with fabricated or
 * partial attribution — an unattributable scoped fact must never reach a managed agent.
 *
 * @param raw - Stored record text as returned by Cognee.
 * @returns The decoded content and provenance, or null when the record is unusable.
 */
export function __DecodeScopedEnvelope(raw: string): { readonly content: string; readonly provenance: MemoryProvenance } | null
{
	let parsed: unknown;
	try
	{
		parsed = JSON.parse(raw) as unknown;
	}
	catch
	{
		return null;
	}
	const envelope = _AsObject(parsed);
	const provenance = _AsObject(envelope?.["provenance"]);
	if (!envelope || envelope["v"] !== _SCOPED_ENVELOPE_VERSION || typeof envelope["content"] !== "string" || !provenance) return null;
	if (!_IsText(provenance["centralAgentId"]) || !_IsText(provenance["agentRevisionId"]) || !_IsText(provenance["runId"]) || !_IsText(provenance["recordedAt"]) || !_IsText(provenance["sourceRef"])) return null;
	if (!Number.isFinite(Date.parse(provenance["recordedAt"]))) return null;
	return {
		content: envelope["content"],
		provenance: { centralAgentId: provenance["centralAgentId"], agentRevisionId: provenance["agentRevisionId"], runId: provenance["runId"], recordedAt: provenance["recordedAt"], sourceRef: provenance["sourceRef"] },
	};
}

/**
 * Convert a Cognee search response into facts, keeping only entries the gateway fully identified.
 *
 * An entry becomes a fact only if it carries BOTH an identifier and text; a malformed entry is
 * dropped rather than given an invented id. The id may arrive as `id`, `data_id`, or `document_id`,
 * and the text as `text`, `content`, or `chunk`. A response whose overall shape is unrecognised is a
 * protocol failure, so a broken contract can never look like "no facts found".
 *
 * Called by: http-cognee-memory-gateway-client.ts inside `query`, and {@link __ParseScopedFacts}
 * below with an unbounded limit.
 *
 * @param payload - Untrusted Cognee search response.
 * @param maxResults - Most facts to return.
 * @returns The accepted facts, at most `maxResults` of them, in the order the gateway sent them.
 * @throws {MemoryGatewayProtocolError} When the response is not an array of entries.
 */
export function __ParseSearchFacts(payload: unknown, maxResults: number): readonly MemoryFact[]
{
	const entries = _SearchEntries(payload);
	const facts: MemoryFact[] = [];
	for (const entry of entries)
	{
		const item = _AsObject(entry);
		if (!item) continue;
		const factId = item["id"] ?? item["data_id"] ?? item["document_id"];
		const content = item["text"] ?? item["content"] ?? item["chunk"];
		if (!_IsText(factId) || typeof content !== "string") continue;
		facts.push({ factId, content });
		if (facts.length >= maxResults) break;
	}
	return facts;
}

/**
 * Convert a Cognee search response into scoped facts, dropping any record that cannot prove complete
 * provenance.
 *
 * It reads EVERY entry the response contains rather than just the first `maxResults`, because
 * unattributable records are dropped along the way, and stops once `maxResults` usable facts have
 * been collected. That is deliberate: a few bad records must not shrink a caller's result set.
 *
 * Called by: http-cognee-memory-gateway-client.ts inside `recallScoped`.
 *
 * @param payload - Untrusted Cognee search response.
 * @param maxResults - Most facts to return.
 * @returns Facts that carry complete provenance, at most `maxResults` of them.
 * @throws {MemoryGatewayProtocolError} When the response is not an array of entries.
 */
export function __ParseScopedFacts(payload: unknown, maxResults: number): readonly ScopedMemoryFact[]
{
	const facts: ScopedMemoryFact[] = [];
	for (const fact of __ParseSearchFacts(payload, Number.MAX_SAFE_INTEGER))
	{
		const envelope = __DecodeScopedEnvelope(fact.content);
		if (envelope === null) continue;
		facts.push({ factId: fact.factId, content: envelope.content, provenance: envelope.provenance });
		if (facts.length >= maxResults) break;
	}
	return facts;
}

/** Locate the result array in a Cognee search response, rejecting an unrecognised envelope. */
function _SearchEntries(payload: unknown): readonly unknown[]
{
	if (Array.isArray(payload)) return payload;
	throw new MemoryGatewayProtocolError("Memory gateway returned an unrecognised search response");
}
