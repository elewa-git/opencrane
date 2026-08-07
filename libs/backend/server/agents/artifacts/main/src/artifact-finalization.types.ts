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

/** Browser-safe metadata for one asset owned by the signed-in user. */
export interface PersonalArtifactEntry
{
	/** Stable logical asset identifier. */
	readonly id: string;
	/** High-level purpose of the asset. */
	readonly kind: "document" | "generated" | "skill" | "upload";
	/** Current lifecycle state, excluding terminally deleted assets. */
	readonly state: "active" | "deletion_pending";
	/** Current revision identifier when a revision has been finalized. */
	readonly currentRevisionId: string | null;
	/** Browser-safe media type of the current revision when one exists. */
	readonly mediaType: string | null;
	/** Exact decimal byte count of the current revision when one exists. */
	readonly byteLength: string | null;
	/** Search/index lifecycle state of the current revision when one exists. */
	readonly indexState: "pending" | "indexed" | "failed" | "removal_pending" | "removed" | null;
	/** Creation instant in ISO-8601 form. */
	readonly createdAt: string;
	/** Most recent metadata or current-pointer update instant in ISO-8601 form. */
	readonly updatedAt: string;
}

/** Reads browser-safe personal asset metadata from an exact owner and silo boundary. */
export interface PersonalArtifactCatalogueRepository
{
	/** Returns a bounded deterministic list of non-deleted assets owned by one user in one silo. */
	listOwnedCatalogue(siloId: string, ownerPrincipalId: string): Promise<readonly PersonalArtifactEntry[]>;
}

/** Stable result of ArtifactRevision finalization. */
export type FinalizeArtifactRevisionResult =
	| { readonly outcome: "finalized"; readonly idempotent: boolean }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "conflict" | "artifact_not_found" | "lease_not_found" | "receipt_consumed" };
