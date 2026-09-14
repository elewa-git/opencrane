import type { MemoryGatewaySearchFact } from "@opencrane/contracts";

import type { MemoryFact, MemoryProvenance, ScopedMemoryFact } from "./memory-gateway-client.types";

/** Version written into a scoped record so its provenance can be decoded safely. */
const _SCOPED_ENVELOPE_VERSION = 1;

/** Returns a plain object suitable for security-boundary parsing. */
function _AsObject(value: unknown): Record<string, unknown> | null
{
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Returns whether an untrusted value is a non-blank string. */
function _IsText(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decodes one stored scoped envelope or drops it when complete provenance cannot be proven.
 *
 * Called by: `__ParseScopedFacts` while projecting the shared search response.
 *
 * @param raw - Stored record text returned through the private gateway.
 * @returns Decoded content and provenance, or null for an unusable record.
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
	if (!envelope || envelope["v"] !== _SCOPED_ENVELOPE_VERSION || typeof envelope["content"] !== "string" || !provenance)
		return null;
	if (!_IsText(provenance["centralAgentId"]) || !_IsText(provenance["agentRevisionId"]) || !_IsText(provenance["runId"]) || !_IsText(provenance["recordedAt"]) || !_IsText(provenance["sourceRef"]))
		return null;
	if (!Number.isFinite(Date.parse(provenance["recordedAt"])))
		return null;
	return {
		content: envelope["content"],
		provenance: { centralAgentId: provenance["centralAgentId"], agentRevisionId: provenance["agentRevisionId"], runId: provenance["runId"], recordedAt: provenance["recordedAt"], sourceRef: provenance["sourceRef"] },
	};
}

/** Projects shared gateway facts into the existing server-facing document/chunk vocabulary. */
export function __ProjectSearchFacts(facts: readonly MemoryGatewaySearchFact[]): readonly MemoryFact[]
{
	return facts.map(function _ProjectFact(fact): MemoryFact
	{
		return { cogneeDocumentId: fact.documentId, cogneeChunkId: fact.chunkId, content: fact.content };
	});
}

/**
 * Projects attributable records from one validated shared search response.
 *
 * Records with a missing or malformed envelope are dropped. The method scans the complete bounded
 * response so malformed records before a valid one do not shrink the requested result count.
 *
 * Called by: `MemoryGatewayClient.recallScoped`.
 *
 * @param facts - Validated gateway facts with separate document and chunk identities.
 * @param maxResults - Maximum attributable facts returned to the caller.
 * @returns Attributable facts in gateway order.
 */
export function __ParseScopedFacts(facts: readonly MemoryFact[], maxResults: number): readonly ScopedMemoryFact[]
{
	const scoped: ScopedMemoryFact[] = [];
	for (const fact of facts)
	{
		const envelope = __DecodeScopedEnvelope(fact.content);
		if (envelope === null)
			continue;
		scoped.push({ cogneeDocumentId: fact.cogneeDocumentId, cogneeChunkId: fact.cogneeChunkId, content: envelope.content, provenance: envelope.provenance });
		if (scoped.length >= maxResults)
			break;
	}
	return scoped;
}
