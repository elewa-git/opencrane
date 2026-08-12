/** A byte stream supplied for one authorized artifact upload. */
export type ArtifactByteStream = AsyncIterable<Uint8Array>;

/** A lease that has ALREADY been verified. A storage adapter trusts it as-is and never authenticates it, so constructing one without verifying a real lease bypasses authorization entirely. */
export interface VerifiedArtifactWriteLease
{
	/** Durable OpenCrane-issued lease identifier. */
	readonly leaseId: string;
	/** Silo in which the catalog remains authoritative. */
	readonly siloId: string;
	/** Exact logical artifact that may receive the promoted bytes. */
	readonly artifactId: string;
	/** Exact capability action that authorized the bytes. */
	readonly action: "artifact.write";
	/** Epoch-second expiry after which staging must be rejected. */
	readonly expiresAtEpochSeconds: number;
}

/** What a verified upload lease permits. A null `expectedContentAddress` or `expectedByteLength` means the lease is unbounded, which the promotion protocol rejects — see {@link __PromoteArtifactUpload}. */
export interface ArtifactPromotionLeaseClaims extends VerifiedArtifactWriteLease
{
	/** Exact canonical address that the incoming bytes must match, or null for an unbounded lease. */
	readonly expectedContentAddress: string | null;
	/** Exact byte length that the incoming bytes must match, or null for an unbounded lease. */
	readonly expectedByteLength: number | null;
	/** Media type retained in the promotion receipt and later catalog revision. */
	readonly mediaType: string;
}

/** Ask a store to hash and durably stage one upload's bytes. Staged bytes are private and not yet visible in the catalog; promotion is a separate step. */
export interface StageArtifactCommand
{
	/** Already-verified lease supplied by the OpenCrane catalog. The storage adapter never authenticates it. */
	readonly lease: VerifiedArtifactWriteLease;
	/** Untrusted bytes to hash and durably stage. */
	readonly bytes: ArtifactByteStream;
	/** Expected content address when the caller already knows it, otherwise null. */
	readonly expectedContentAddress: string | null;
	/** Expected byte length when the caller already knows it, otherwise null. */
	readonly expectedByteLength: number | null;
	/** Claimed media type retained with the promotion receipt. */
	readonly mediaType: string;
}

/** Bytes that are stored and hashed but not yet published. Nothing may reference them until {@link __PromoteArtifactUpload} promotes them to their content address. */
export interface StagedArtifact
{
	/** Lease that owns this temporary staged file. */
	readonly leaseId: string;
	/** Opaque adapter-local staging handle. */
	readonly stagingHandle: string;
	/** Computed lowercase SHA-256 content address. */
	readonly contentAddress: string;
	/** Exact staged byte count. */
	readonly byteLength: number;
	/** Media type retained from the validated stage command. */
	readonly mediaType: string;
}

/** Bytes now published at their content address. `created` is false when an identical object was already there, which is normal — two uploads of identical content converge on one object. */
export interface ArtifactStorePromotion
{
	/** Lease whose staged bytes were promoted. */
	readonly leaseId: string;
	/** Canonical lowercase SHA-256 content address. */
	readonly contentAddress: string;
	/** Exact immutable byte count. */
	readonly byteLength: number;
	/** Media type recorded for later catalog finalization. */
	readonly mediaType: string;
	/** Whether this call first created the canonical object. */
	readonly created: boolean;
}

/** Result of deleting bytes. `removed` is false when they were already gone, which is a success, not a failure. */
export interface ArtifactStorePurgeResult
{
	/** Whether canonical bytes were removed by this call. */
	readonly purged: boolean;
}

/** How the promotion protocol verifies a lease. Injected so the protocol never imports a key or a crypto library; implemented over {@link __VerifyArtifactWriteLease}. */
export interface ArtifactPromotionLeaseVerifier
{
	/** Returns verified claims when the compact lease is authentic and current, otherwise null. */
	verify(compactLease: string, nowEpochSeconds: number): ArtifactPromotionLeaseClaims | null;
}

/** How the promotion protocol obtains a receipt. Injected so the protocol holds no signing key; implemented over {@link __SignArtifactPromotionReceipt}. */
export interface ArtifactPromotionReceiptSigner
{
	/** Signs immutable promotion facts with the artifact-service receipt authority. */
	sign(claims: ArtifactPromotionReceiptClaims): string;
}

/** Signed facts passed to the receipt signer after a canonical promotion. */
export interface ArtifactPromotionReceiptClaims
{
	/** Lease that authorized the corresponding byte stream. */
	readonly leaseId: string;
	/** Canonical SHA-256 address that the store promoted. */
	readonly contentAddress: string;
	/** Exact number of canonical bytes. */
	readonly byteLength: number;
	/** Validated media type attached to the canonical bytes. */
	readonly mediaType: string;
	/** Epoch-second receipt issuance time. */
	readonly issuedAtEpochSeconds: number;
}

/** The upload, as the promotion protocol sees it: the lease, the transport's declared length if it gave one, the bytes, and an `abort` the protocol calls when the deadline passes. Deliberately free of HTTP types so the protocol is testable without a server. */
export interface BoundedArtifactUploadByteSource
{
	/** Compact OpenCrane lease supplied by the HTTP adapter. */
	readonly compactLease: string | null;
	/** Raw declared content length, or null when the transport did not provide one. */
	readonly declaredByteLength: string | null;
	/** Untrusted request bytes, bounded again by the storage adapter. */
	readonly bytes: ArtifactByteStream;
	/** Cancels the underlying transport after the absolute promotion deadline is exceeded. */
	abort(reason: Error): void;
}

/** Timing and signing for one promotion. `nowEpochMilliseconds` is injected rather than read from the clock, so a test can drive the deadline deterministically. */
export interface ArtifactPromotionProtocolConfig
{
	/** Hard promotion duration before the protocol cancels the byte source. */
	readonly maxUploadDurationMilliseconds: number;
	/** Current wall-clock epoch milliseconds, injected for deterministic protocol tests. */
	readonly nowEpochMilliseconds: () => number;
	/** Receipt authority that signs only a completed canonical promotion. */
	readonly receiptSigner: ArtifactPromotionReceiptSigner;
}

/**
 * What {@link __PromoteArtifactUpload} can return.
 *
 * Three shapes, and a caller must branch on `outcome`: `promoted` carries the object and its
 * receipt, `rejected` carries a stable reason for a 4xx, and `deadline_exceeded` means the upload
 * ran out of time — bytes may already be staged, so it must not be reported to the user as a
 * clean failure. A transport maps these to status codes; the protocol never throws for them.
 */
export type PromoteArtifactUploadResult =
	| { readonly outcome: "promoted"; readonly promotion: ArtifactStorePromotion; readonly receipt: string }
	| { readonly outcome: "rejected"; readonly reason: "invalid_artifact_lease" | "artifact_body_exceeds_lease" | "expired_artifact_lease" }
	| { readonly outcome: "deadline_exceeded" };

/**
 * How the promotion protocol talks to durable storage.
 *
 * An adapter stores and reads bytes and nothing else: OpenCrane owns leases, receipts, catalog
 * state, and every access decision, so an adapter must never authenticate a lease or decide
 * whether a read is allowed. Implemented by `__FilesystemArtifactStore`.
 *
 * `stage` then `promote` is the write path — staged bytes are private until promoted. `promote`
 * and `purge` are both idempotent, so a retry is safe.
 */
export interface ArtifactStore
{
	/**
	 * Hash the bytes and store them privately, without publishing anything.
	 * @param command - The verified lease, the byte stream, and the expected address, length, and media type.
	 * @returns The staged object, including the content address actually computed from the bytes.
	 * @throws Error when the bytes do not match an expected address or length the lease pinned.
	 */
	stage(command: StageArtifactCommand): Promise<StagedArtifact>;
	/**
	 * Publish staged bytes at their content address, atomically.
	 * @param staged - The result of a previous `stage` call.
	 * @returns The published object; `created` is false when identical bytes were already published.
	 */
	promote(staged: StagedArtifact): Promise<ArtifactStorePromotion>;
	/** Returns the size of one regular canonical object, or null when it is absent or not a regular file. */
	byteLength(contentAddress: string): Promise<number | null>;
	/** Reads canonical bytes by an already-authorized immutable content address. */
	read(contentAddress: string): Promise<ArtifactByteStream | null>;
	/**
	 * Delete published bytes. The caller must already have proved no lease or catalog reference
	 * remains — the adapter does not and cannot check.
	 * @param contentAddress - The content address to delete.
	 * @returns Whether bytes were removed; false when they were already gone.
	 */
	purge(contentAddress: string): Promise<ArtifactStorePurgeResult>;
}
