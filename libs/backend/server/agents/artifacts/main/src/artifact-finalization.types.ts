/**
 * The artifact service's signed confirmation that specific bytes are stored.
 *
 * Handed in already verified. Finalization compares every field against the stored lease row
 * before publishing anything, because a receipt with a good signature could still describe a
 * different lease or different bytes.
 *
 * @see {@link FinalizeArtifactRevisionCommand} which carries this into the commit.
 */
export interface ArtifactStorePromotionReceipt
{
	/** The lease this receipt answers. Must match the lease row the revision is committed against. */
	readonly leaseId: string;
	/** Hash of the stored bytes, as `sha256:` plus 64 lowercase hex characters. */
	readonly contentAddress: string;
	/** Byte count of the stored bytes. Must equal what the lease reserved. */
	readonly byteLength: number;
	/** Media type of the stored bytes. Must equal what the lease reserved. */
	readonly mediaType: string;
	/** Hash of the receipt string itself, stored on the lease row so the same receipt cannot commit twice. */
	readonly receiptDigest: string;
}
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

/**
 * Everything needed to publish one revision for bytes that are already stored.
 *
 * All fields are validated before the transaction opens: ids must be non-blank, `revision` must
 * be a positive safe integer, and the receipt's hash, digest, size, and media type must all be
 * well formed. `idempotencyKey` is what makes a retry after a lost response commit nothing new
 * instead of publishing a second revision.
 */
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
	/** Where this revision came from, stored as JSON on the revision row. For converted output it records the pipeline version and the source revision id. */
	readonly provenance: Readonly<Record<string, unknown>>;
	/** Verified ArtifactStore promotion evidence. */
	readonly promotion: ArtifactStorePromotionReceipt;
	/** Stable idempotency key for revision plus outbox commit. */
	readonly idempotencyKey: string;
}

/**
 * What the finalize transaction did, in the database's own words.
 *
 * Two of these are success and four are refusals, and conflating them will make a caller report
 * a revision as published when nothing was written. `finalized` committed. `idempotent` found
 * the same idempotency key already produced this exact revision, so there was nothing left to
 * do - also success. `artifact_not_found` means no Active artifact at that id.
 * `lease_not_found` means the lease is missing, belongs to another artifact, or has expired.
 * `receipt_consumed` means the lease was already promoted or finalized, so this receipt is spent.
 * `conflict` means the lease exists but reserved different bytes, a different size, or a
 * different media type than the receipt claims, or the database rolled the attempt back after
 * exhausting its retries.
 *
 * Every non-success value leaves the database untouched.
 *
 * @see {@link FinalizeArtifactRevisionResult} for the shape the use case returns to its caller.
 */
export type AtomicFinalizeArtifactResult = { readonly status: "finalized" } | { readonly status: "idempotent" } | { readonly status: "conflict" } | { readonly status: "artifact_not_found" } | { readonly status: "lease_not_found" } | { readonly status: "receipt_consumed" };

/**
 * Commits one revision and everything that must land with it.
 *
 * Four writes go in a single transaction - the revision row, the artifact's current-revision
 * pointer, the spent lease, and the outbox event - so a retry can never publish the revision
 * twice or publish it without its event. Implemented by `_ArtifactUploadAuthority`, which opens
 * the transaction, over `PrismaArtifactAuthorityRepository`, which runs the SQL inside it.
 *
 * Called by: `__FinalizeArtifactRevision` in artifact-finalization.ts.
 */
export interface ArtifactAuthorityRepository
{
	/**
	 * Publishes the revision for bytes the artifact service has already stored.
	 *
	 * @param command - Validated revision metadata plus the verified promotion receipt.
	 * @returns One of the six statuses in {@link AtomicFinalizeArtifactResult}; only `finalized`
	 *   and `idempotent` mean the revision is visible.
	 * @throws Error when the database clock row cannot be read, since expiry checks would
	 *   otherwise fall back to process time and could accept an expired lease.
	 */
	finalizeRevisionAtomically(command: FinalizeArtifactRevisionCommand): Promise<AtomicFinalizeArtifactResult>;
}

/**
 * One asset as the browser is allowed to see it.
 *
 * Deliberately excludes content addresses, byte streams, leases, receipts, provenance, and
 * outbox data. `byteLength` is a decimal string because the column is a 64-bit integer and JSON
 * numbers would lose precision on large files.
 *
 * @see {@link PersonalArtifactCatalogueRepository.listOwnedCatalogue} which produces these.
 */
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

/**
 * Lists the signed-in user's own assets.
 *
 * Both the silo and the owner are required arguments rather than filters applied later, so
 * there is no way to call this and get another user's assets. Implemented by
 * `PrismaArtifactCatalogueRepository`, built through `_CreateArtifactCatalogueRepository`.
 *
 * Called by: the `GET /` handler in personal-artifact-catalogue.router.ts, mounted at
 * `/api/v1/me/assets` by apps/opencrane/src/app/routes.ts.
 */
export interface PersonalArtifactCatalogueRepository
{
	/**
	 * Lists assets owned by one user in one silo.
	 *
	 * @param siloId - Silo taken from the trusted request host, never from the request body.
	 * @param ownerPrincipalId - Signed-in principal from the verified session.
	 * @returns At most fifty non-deleted assets that have a current revision, newest updated
	 *   first with the id breaking ties so paging order is stable. An empty array is a normal
	 *   answer, not an error.
	 * @throws Whatever the database driver throws; the router logs it and answers 503.
	 */
	listOwnedCatalogue(siloId: string, ownerPrincipalId: string): Promise<readonly PersonalArtifactEntry[]>;
}

/**
 * What `__FinalizeArtifactRevision` returns.
 *
 * `finalized` means the revision is visible; `idempotent` only says whether this call did the
 * writing or found them already done, and both are success. A `denied` result means nothing was
 * written, and `reason` carries the database's own status through unchanged - `invalid_command`
 * for a field that failed validation before the transaction, and the rest as described in
 * {@link AtomicFinalizeArtifactResult}.
 */
export type FinalizeArtifactRevisionResult =
	| { readonly outcome: "finalized"; readonly idempotent: boolean }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "conflict" | "artifact_not_found" | "lease_not_found" | "receipt_consumed" };
