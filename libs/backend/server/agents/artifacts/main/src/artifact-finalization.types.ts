/** ArtifactStore promotion receipt verified before metadata finalization. */
export interface ArtifactStorePromotionReceipt
{
	/** Lease that authorized staging and promotion. */
	readonly leaseId: string;
	/** Lowercase SHA-256 address produced by ArtifactStore. */
	readonly contentAddress: string;
	/** Exact promoted byte count. */
	readonly byteLength: number;
	/** Exact promoted media type. */
	readonly mediaType: string;
	/** Opaque single-use receipt digest authenticated by ArtifactStore. */
	readonly receiptDigest: string;
}

/** Request to finalize promoted bytes into visible artifact metadata. */
export interface FinalizeArtifactRevisionCommand
{
	/** Logical artifact receiving the revision. */
	readonly artifactId: string;
	/** Positive next revision number. */
	readonly revision: number;
	/** Identifier assigned to the immutable revision. */
	readonly artifactRevisionId: string;
	/** Principal that completed the authorized write. */
	readonly createdBy: string;
	/** Structured source and lineage provenance. */
	readonly provenance: Readonly<Record<string, unknown>>;
	/** Verified ArtifactStore promotion evidence. */
	readonly promotion: ArtifactStorePromotionReceipt;
	/** Stable idempotency key for revision plus outbox commit. */
	readonly idempotencyKey: string;
}

/** Atomic finalize result from the Artifact persistence authority. */
export type AtomicFinalizeArtifactResult = { readonly status: "finalized" } | { readonly status: "idempotent" } | { readonly status: "conflict" } | { readonly status: "artifact_not_found" } | { readonly status: "lease_not_found" } | { readonly status: "receipt_consumed" };

/** Persistence boundary committing revision metadata, current pointer, lease consumption, and outbox together. */
export interface ArtifactAuthorityRepository
{
	/** Finalizes exact promoted bytes in one transaction with no byte I/O in this domain. */
	finalizeRevisionAtomically(command: FinalizeArtifactRevisionCommand): Promise<AtomicFinalizeArtifactResult>;
}

/** Stable result of ArtifactRevision finalization. */
export type FinalizeArtifactRevisionResult =
	| { readonly outcome: "finalized"; readonly idempotent: boolean }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "conflict" | "artifact_not_found" | "lease_not_found" | "receipt_consumed" };
