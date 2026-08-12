import type { MemoryProvenance } from "./memory-gateway-client.types.js";

/**
 * Thrown when a scoped memory write does not name all five provenance fields.
 *
 * The message names the first field that was missing, and nothing else — the record content never
 * appears in it. This is a refusal before any write happens: the caller must fix the provenance,
 * because a record with partial attribution is not allowed to exist in a shared scope.
 */
export class MemoryProvenanceIncompleteError extends Error
{
	/** Creates a fail-closed provenance violation. */
	constructor(field: string)
	{
		super(`scoped memory write requires complete provenance; missing: ${field}`);
		this.name = "MemoryProvenanceIncompleteError";
	}
}

/**
 * Check that a provenance record is complete before a scoped memory write is allowed.
 *
 * Every record a central agent writes into a shared knowledge scope MUST be traceable to the agent,
 * its revision, the run that produced it, when it was recorded, and where it came from. A missing or
 * blank field — or a `recordedAt` that is not a parseable date — fails closed with
 * {@link MemoryProvenanceIncompleteError} rather than writing a record nobody can attribute later.
 *
 * Called by: http-cognee-memory-gateway-client.ts and unavailable-memory-gateway-client.ts, both as
 * the first statement of `injectScoped`, so the check runs even when no gateway is configured.
 *
 * @param provenance - The provenance to check.
 * @throws {MemoryProvenanceIncompleteError} Naming the first field that is missing, blank, or (for
 *   `recordedAt`) not a parseable date.
 */
export function __AssertMemoryProvenanceComplete(provenance: MemoryProvenance): void
{
	const fields: readonly [keyof MemoryProvenance, string][] = [["centralAgentId", provenance.centralAgentId], ["agentRevisionId", provenance.agentRevisionId], ["runId", provenance.runId], ["recordedAt", provenance.recordedAt], ["sourceRef", provenance.sourceRef]];
	for (const [name, value] of fields)
	{
		if (typeof value !== "string" || value.trim().length === 0) throw new MemoryProvenanceIncompleteError(name);
	}
	if (!Number.isFinite(Date.parse(provenance.recordedAt))) throw new MemoryProvenanceIncompleteError("recordedAt");
}
