import type { ArtifactPromotionReceiptClaims, ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";

/**
 * One upload whose authorization has already been checked, ready to execute.
 *
 * The name is the contract: whoever builds this has already verified the caller's proof and
 * reserved its replay key. `__UploadArtifact` does not re-check any of that, so constructing this
 * type from unverified input would hand out write authority.
 *
 * The upload runs as two short database transactions with an external byte promotion in between:
 * reserve a write lease, promote the bytes through the artifact service, then commit the
 * revision. Nothing here is a storage location - the bytes are streamed to the artifact service,
 * which is the only component that knows where they land.
 *
 * @see {@link ArtifactUploadResult} for what a caller must do when the second transaction fails.
 */
export interface VerifiedArtifactUploadCommand
{
	/** Logical artifact receiving the new revision. Must exist and be Active in `siloId`. */
	readonly artifactId: string;
	/** Silo that must own the artifact. */
	readonly siloId: string;
	/** Replay key from the caller's proof. Reusing it returns the same lease instead of a second one. */
	readonly capabilityJti: string;
	/** Content address the promoted bytes must hash to, as `sha256:` plus 64 lowercase hex characters. */
	readonly expectedContentAddress: string;
	/** Byte count the promoted bytes must have. A mismatch is refused rather than recorded. */
	readonly expectedByteLength: number;
	/** Media type the promoted bytes must have. `application/pdf` also schedules a text-conversion job. */
	readonly mediaType: string;
	/** Lease expiry, in whole seconds since the epoch. After it, promotion and finalization both fail. */
	readonly expiresAtEpochSeconds: number;
	/** Principal recorded as the author of the revision. */
	readonly createdBy: string;
	/** Revision number for this artifact, starting at 1. */
	readonly revision: number;
	/** Id to give the new revision row. */
	readonly artifactRevisionId: string;
	/** Source and lineage details stored as JSON on the revision. */
	readonly provenance: Readonly<Record<string, unknown>>;
	/** Key that makes the revision plus its outbox event commit once, however many times this runs. */
	readonly idempotencyKey: string;
	/** The bytes. Streamed straight to the artifact service and never buffered in this package. */
	readonly bytes: AsyncIterable<Uint8Array>;
}
export interface VerifiedArtifactUploadCommand
{
	readonly artifactId: string;
	readonly siloId: string;
	readonly capabilityJti: string;
	readonly expectedContentAddress: string;
	readonly expectedByteLength: number;
	readonly mediaType: string;
	readonly expiresAtEpochSeconds: number;
	readonly createdBy: string;
	readonly revision: number;
	readonly artifactRevisionId: string;
	readonly provenance: Readonly<Record<string, unknown>>;
	readonly idempotencyKey: string;
	readonly bytes: AsyncIterable<Uint8Array>;
}

/**
 * Reserves the write permission for one upload - the first of the two transactions.
 *
 * The parameter drops the fields only finalization needs, so this step cannot write revision
 * metadata. Implemented by `_ArtifactUploadAuthority` over `PrismaArtifactAuthorityRepository`.
 *
 * Called by: `__UploadArtifact` in artifact-upload.ts.
 */
export interface ArtifactUploadLeaseRepository
{
	/**
	 * Creates the lease for this upload, or returns the existing one for the same replay key.
	 *
	 * @param command - The upload facts the lease is bound to, without the finalization-only fields.
	 * @returns `issued` with the claims to sign; `artifact_not_found` when no Active artifact
	 *   exists at those ids; `conflict` when a lease already exists for this replay key but was
	 *   issued for different bytes, a different expiry, or is no longer usable. Neither refusal
	 *   leaves anything to clean up, because no bytes have moved yet.
	 */
	issueLeaseAtomically(command: Omit<VerifiedArtifactUploadCommand, "bytes" | "createdBy" | "revision" | "artifactRevisionId" | "provenance" | "idempotencyKey">): Promise<{ readonly status: "issued"; readonly lease: ArtifactWriteLeaseClaims } | { readonly status: "artifact_not_found" | "conflict" }>;
}

/**
 * Sends the bytes to the private artifact service - the external step between the two transactions.
 *
 * The service stages the bytes, checks them against the lease, and returns a signed receipt. This
 * package never learns where they were stored.
 *
 * Called by: `__UploadArtifact` in artifact-upload.ts. Implemented by
 * `_CreateArtifactServicePromotionPort` in apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts.
 */
export interface ArtifactServicePromotionPort
{
	/**
	 * Streams the bytes under one signed write lease.
	 *
	 * @param lease - The compact signed write lease.
	 * @param bytes - The bytes to store, streamed rather than buffered.
	 * @returns The compact signed receipt, still unverified at this point.
	 * @throws When the service is unreachable, answers a non-2xx status, or returns no receipt.
	 *   The bytes may or may not be stored, so the caller must not assume either way.
	 */
	promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }>;
}

/**
 * Signing and verification, injected so this package never touches key material.
 *
 * The app loads the private signing key and the public receipt key from mounted files and passes
 * these three functions in. That keeps key handling in one place instead of spreading it through
 * the upload flow.
 *
 * Called by: `__UploadArtifact` in artifact-upload.ts. Supplied inline by
 * `_CreateArtifactUploadGateway` in apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts.
 */
export interface ArtifactUploadCryptoPort
{
	/**
	 * Signs the write lease so the artifact service will accept the promotion.
	 *
	 * @param claims - Lease claims as returned by the reservation transaction, unmodified.
	 * @returns The compact signed lease.
	 * @throws When the mounted signing key is missing or unusable.
	 */
	signLease(claims: ArtifactWriteLeaseClaims): string;
	/**
	 * Checks the receipt's signature and reads its claims.
	 *
	 * @param compact - The receipt string returned by the artifact service.
	 * @returns The claims, or null when the signature does not verify. Null is refused as
	 *   `promotion_invalid`; the caller then also compares each claim against the lease, because a
	 *   valid signature over the wrong lease must not be accepted.
	 */
	verifyReceipt(compact: string): ArtifactPromotionReceiptClaims | null;
	/**
	 * Hashes the receipt string so the same receipt cannot be used twice.
	 *
	 * @param compact - The exact receipt string that was verified.
	 * @returns A `sha256:` digest, stored on the lease row when the revision commits.
	 */
	digestReceipt(compact: string): string;
}

/**
 * What `__UploadArtifact` returns, and what each answer obliges the caller to do.
 *
 * `finalized` means the revision is visible; `idempotent` distinguishes a first commit from a
 * replay of the same one, and both are success.
 *
 * The three denials are not equivalent. `lease_issue_failed` happens before any bytes move, so
 * nothing exists anywhere and the request can simply be reported as rejected.
 * `promotion_invalid` and `finalization_failed` both happen after the bytes were promoted:
 * something is sitting in artifact storage with no revision pointing at it. This package does
 * not delete it, and a caller must not retry with a new revision id in the hope of tidying up -
 * report the failure, keep the original request's replay key, and leave the unreferenced bytes to
 * artifact-service cleanup. Retrying the identical command is safe, because the same replay key
 * returns the same lease and the same idempotency key commits at most once.
 */
export type ArtifactUploadResult = { readonly outcome: "finalized"; readonly idempotent: boolean } | { readonly outcome: "denied"; readonly reason: "lease_issue_failed" | "promotion_invalid" | "finalization_failed" };
