import { MemoryGatewayProtocolError } from "./personal-memory-record.js";
import type { MemoryFact, MemoryProvenance, ScopedMemoryFact } from "./memory-gateway-client.types.js";

/** Envelope revision written around scoped content so provenance survives a Cognee round trip. */
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

/** Wrap scoped content so its mandatory provenance is stored with the record itself. */
export function __EncodeScopedEnvelope(content: string, provenance: MemoryProvenance): string
{
	return JSON.stringify({ v: _SCOPED_ENVELOPE_VERSION, content, provenance });
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
 * Project a Cognee search response into gateway-minted facts.
 *
 * Only entries carrying BOTH a remote identifier and text become facts; a malformed entry is
 * dropped rather than given a synthesised id. An entirely unrecognised response shape is a protocol
 * violation, so a broken contract can never masquerade as an empty recall.
 *
 * @param payload - Untrusted Cognee search response.
 * @param maxResults - Upper bound the caller requested.
 * @returns The validated facts, truncated to the requested bound.
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

/** Project a Cognee search response into scoped facts, dropping unattributable records. */
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
	const root = _AsObject(payload);
	for (const key of ["results", "search_results", "data"])
	{
		const candidate = root?.[key];
		if (Array.isArray(candidate)) return candidate;
	}
	throw new MemoryGatewayProtocolError("Memory gateway returned an unrecognised search response");
}

/**
 * Extract the remote fact identifier minted by an add response.
 *
 * The identifier must originate from Cognee; an unrecognised shape fails closed so no locally
 * invented id is ever recorded as durable evidence.
 *
 * @param payload - Untrusted Cognee add response.
 * @returns The gateway-minted identifier.
 */
export function __ParseAddedFactId(payload: unknown): string
{
	const root = _AsObject(payload);
	const direct = root?.["id"] ?? root?.["data_id"] ?? root?.["document_id"];
	if (_IsText(direct)) return direct;
	const collection = Array.isArray(payload) ? payload : Array.isArray(root?.["data"]) ? root["data"] : null;
	const first = _AsObject(collection?.[0]);
	const nested = first?.["id"] ?? first?.["data_id"] ?? first?.["document_id"];
	if (_IsText(nested)) return nested;
	throw new MemoryGatewayProtocolError("Memory gateway returned no fact identifier for an accepted write");
}
