import type { SiloId, UserId } from "@opencrane/models/agents";
import type { ArtifactRevisionId } from "@opencrane/models/artifacts";
import type { AuthorizationScope } from "@opencrane/models/authorization";

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

/** The two changes a user may ask the memory gateway to make to a stored fact. */
export enum MemoryMutationKind
{
  /** Replace a wrong fact with a corrected one. The old provenance and revision history are kept, so nothing is lost. */
  Correct = "correct",
  /** Delete a fact and everything derived from it. Unlike a correction, nothing is kept. */
  Forget = "forget",
}

/** Which Cognee dataset a query may touch: its id, the silo containing it, the scope it may be queried in, and who owns it. All four must match before a recall is allowed. */
export interface MemoryDatasetIdentity
{
  /** Stable dataset identifier. */
  id: string;
  /** Silo containing the dataset. */
  siloId: SiloId;
  /** Business scope in which the dataset may be queried. */
  scope: AuthorizationScope;
  /** User or managed AgentService that owns the dataset. */
  ownerId: string;
}

/** Evidence for one memory fact: what kind of source it came from, which source, and when it was accepted. */
export interface MemoryProvenance
{
  /** Stable source family, such as message, artifact, or explicit-user-fact. */
  sourceKind: string;
  /** Stable source identifier. */
  sourceId: string;
  /** Exact artifact revision containing canonical source bytes, when applicable. */
  artifactRevisionId?: ArtifactRevisionId;
  /** User who explicitly supplied or corrected the fact, when applicable. */
  sourceUserId?: UserId;
  /** ISO-8601 time at which the source was accepted. */
  capturedAt: string;
}

/** Points at one stored memory fact, with a digest so a reader can tell whether the fact has since been corrected. */
export interface MemoryFactReference
{
  /** Dataset containing the fact. */
  datasetId: string;
  /** Stable fact identifier. */
  factId: string;
  /** Digest of the fact's content as stored. A mismatch means the fact changed after this reference was taken. */
  contentDigest: string;
  /** Provenance supporting the referenced fact. */
  provenance: MemoryProvenance[];
}

/** A request to correct or forget one stored fact. `replacement` is required for a correction and unused for a forget; `reason` is written into the audit record either way. */
export interface MemoryMutationRequest
{
  /** Requested mutation. */
  kind: MemoryMutationKind;
  /** Reference to the stored fact being changed. @see {@link MemoryFactReference} */
  fact: MemoryFactReference;
  /** User requesting the mutation. */
  requestedByUserId: UserId;
  /** Human-readable reason recorded in audit evidence. */
  reason: string;
  /** Replacement statement for a correction. */
  replacement?: string;
}
