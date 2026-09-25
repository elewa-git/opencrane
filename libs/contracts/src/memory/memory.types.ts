/**
 * Audience bound into the ServiceAccount token the OpenCrane server presents to the memory gateway.
 *
 * The server chart projects a token with exactly this audience, and the gateway's TokenReview
 * accepts no other, so a stolen general-purpose server token can never open the private Cognee
 * plane. The chart-side string lives in `apps/memory-gateway/helm/templates/_resources.tpl`
 * (`SERVER_TOKEN_AUDIENCE`) and must stay equal to this constant.
 */
export const MEMORY_GATEWAY_PROJECTED_TOKEN_AUDIENCE = "opencrane-memory-gateway";

/**
 * States whether a failed personal-memory mutation can have reached the memory service.
 *
 * A future mutation-capable memory gateway client returns these values to the existing durable
 * workflow after a mutation fails. They are stable wire values and may be saved with that workflow's
 * recovery evidence, so a renamed member or serialized value is a breaking contract change. Neither
 * state terminates the operation, grants permission, or proves that Cognee applied it.
 */
export enum MemoryMutationDeliveryStates
{
	/** No mutation bytes reached the transport, so the same admitted operation may be retried. */
	ProvenNotSent = "proven_not_sent",
	/** The request may have reached Cognee, so the operation must be reconciled before another send. */
	Ambiguous = "ambiguous",
}

/**
 * Where a memory fact's evidence came from.
 *
 * Every durable fact records one of these, so a reader can tell a fact a user stated outright
 * from one inferred from a message or an artifact. A correction keeps the provenance history,
 * so this is also what an audit reads to see why a fact was believed.
 * @see {@link MemoryProvenance}
 */
export enum MemoryFactProvenanceSourceKinds
{
	/** A conversation message supplied the fact evidence. */
	Message = "message",
	/** An immutable artifact revision supplied the fact evidence. */
	Artifact = "artifact",
	/** An explicitly authenticated user statement supplied the fact evidence. */
	ExplicitUserFact = "explicit-user-fact",
}
