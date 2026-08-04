import type { MemoryProvenance } from "./memory-gateway-client.types.js";

/** Typed failure raised when a scoped memory write lacks complete provenance. */
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
 * Assert that a provenance record is complete before a scoped memory write is allowed.
 *
 * Every record injected into a shared knowledge scope by a central agent MUST be attributable to the
 * agent, its revision, the run that produced it, when it was recorded, and the source it came from.
 * A missing field fails closed with {@link MemoryProvenanceIncompleteError} rather than writing an
 * unattributable fact.
 *
 * @param provenance - The provenance to validate.
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
