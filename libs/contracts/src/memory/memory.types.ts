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
