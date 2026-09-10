import { z } from "zod";

import { MemoryGatewayProtocolError } from "./personal-memory-record-receipt";
import type { MemoryFact, MemoryProvenance, ScopedMemoryFact } from "./memory-gateway-client.types";

/** Version number written into each stored scoped record, so its provenance can be read back safely. A record with any other version is dropped on decode. */
const _SCOPED_ENVELOPE_VERSION = 1;

/**
 * Cognee 1.2.1 CHUNKS payload fields that OpenCrane can interpret safely.
 *
 * Cognee adds other passage metadata, so this validator deliberately strips unknown fields. Both
 * identifiers are required: `id` names the returned chunk, while `document_id` names the Data row
 * that the dataset mutation API accepts.
 */
const _CogneeChunkSchema = z.object({ id: z.string().uuid(), document_id: z.string().uuid(), text: z.string() }).strip();

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
 * An entry becomes a fact only when it carries Cognee's UUID chunk `id`, UUID `document_id`, and
 * `text`. A malformed entry is dropped rather than given an invented identity. The response may
 * contain other Cognee fields, which are ignored. A response whose overall shape is unrecognised is
 * a protocol failure, so a broken contract can never look like "no facts found".
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
		const parsed = _CogneeChunkSchema.safeParse(entry);
		if (!parsed.success)
			continue;
		facts.push({ cogneeDocumentId: parsed.data.document_id, cogneeChunkId: parsed.data.id, content: parsed.data.text });
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
		facts.push({ cogneeDocumentId: fact.cogneeDocumentId, cogneeChunkId: fact.cogneeChunkId, content: envelope.content, provenance: envelope.provenance });
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
