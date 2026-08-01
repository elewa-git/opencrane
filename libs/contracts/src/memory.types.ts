import type { SiloId, UserId } from "@opencrane/models/agents";
import type { ArtifactRevisionId } from "@opencrane/models/artifacts";
import type { AuthorizationScope } from "@opencrane/models/authorization";

/** Provenance source vocabulary shared by memory catalogues and snapshot readers. */
export enum MemoryFactProvenanceSourceKinds
{
  /** A conversation message supplied the fact evidence. */
  Message = "message",
  /** An immutable artifact revision supplied the fact evidence. */
  Artifact = "artifact",
  /** An explicitly authenticated user statement supplied the fact evidence. */
  ExplicitUserFact = "explicit-user-fact",
}

/** Durable memory mutation requested through the memory gateway. */
export enum MemoryMutationKind
{
  /** Replace an incorrect fact while retaining provenance and revision history. */
  Correct = "correct",
  /** Delete an authorized fact and its derived projections. */
  Forget = "forget",
}

/** Canonical identity and authorization boundary of one Cognee dataset. */
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

/** Source provenance attached to a durable memory fact. */
export interface MemoryProvenance
{
  /** Stable source family selected from the platform-owned provenance vocabulary. */
  sourceKind: MemoryFactProvenanceSourceKinds;
  /** Stable source identifier. */
  sourceId: string;
  /** Exact artifact revision containing canonical source bytes, when applicable. */
  artifactRevisionId?: ArtifactRevisionId;
  /** User who explicitly supplied or corrected the fact, when applicable. */
  sourceUserId?: UserId;
  /** ISO-8601 time at which the source was accepted. */
  capturedAt: string;
}

/** Stable reference to one immutable durable memory-fact catalog row. */
export interface MemoryFactReference
{
  /** Dataset containing the fact. */
  datasetId: string;
  /** Stable fact identifier. */
  factId: string;
  /** Immutable content digest recorded by the authoritative memory-fact catalog row. */
  contentDigest: string;
  /** Provenance supporting the referenced fact. */
  provenance: MemoryProvenance[];
}

/** Explicit correction or forgetting request for a durable fact. */
export interface MemoryMutationRequest
{
  /** Requested mutation. */
  kind: MemoryMutationKind;
  /** Exact immutable memory-fact catalog coordinate being changed. */
  fact: MemoryFactReference;
  /** User requesting the mutation. */
  requestedByUserId: UserId;
  /** Human-readable reason recorded in audit evidence. */
  reason: string;
  /** Replacement statement for a correction. */
  replacement?: string;
}
