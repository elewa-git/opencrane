/** A byte stream supplied for one authorized artifact upload. */
export type ArtifactByteStream = AsyncIterable<Uint8Array>;

/** Immutable authorization coordinates already verified by the OpenCrane catalog before byte staging. */
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

/** Write authorization returned by a verified artifact-service lease before bounded-upload checks. */
export interface ArtifactPromotionLeaseClaims extends VerifiedArtifactWriteLease
{
	/** Exact canonical address that the incoming bytes must match, or null for an unbounded lease. */
	readonly expectedContentAddress: string | null;
	/** Exact byte length that the incoming bytes must match, or null for an unbounded lease. */
	readonly expectedByteLength: number | null;
	/** Media type retained in the promotion receipt and later catalog revision. */
	readonly mediaType: string;
}

/** Request to stage one bounded byte stream behind a previously authorized lease. */
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

/** Private staged content that has been hashed but is not yet canonical. */
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

/** Canonical immutable bytes created by an idempotent promotion. */
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

/** Result of an idempotent, reference-authorized physical purge. */
export interface ArtifactStorePurgeResult
{
	/** Whether canonical bytes were removed by this call. */
	readonly purged: boolean;
}

/** Validates one compact OpenCrane lease without coupling promotion to a signing implementation. */
export interface ArtifactPromotionLeaseVerifier
{
	/** Returns verified claims when the compact lease is authentic and current, otherwise null. */
	verify(compactLease: string, nowEpochSeconds: number): ArtifactPromotionLeaseClaims | null;
}

/** Signs the one receipt that lets the catalog consume a successful canonical promotion. */
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

/** HTTP-neutral upload source with a declared-size guard and an adapter-owned cancellation hook. */
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

/** Time and duration policy for one promotion protocol invocation. */
export interface ArtifactPromotionProtocolConfig
{
	/** Hard promotion duration before the protocol cancels the byte source. */
	readonly maxUploadDurationMilliseconds: number;
	/** Current wall-clock epoch milliseconds, injected for deterministic protocol tests. */
	readonly nowEpochMilliseconds: () => number;
	/** Receipt authority that signs only a completed canonical promotion. */
	readonly receiptSigner: ArtifactPromotionReceiptSigner;
}

/** Stable expected outcomes from artifact promotion before a transport translates them. */
export type PromoteArtifactUploadResult =
	| { readonly outcome: "promoted"; readonly promotion: ArtifactStorePromotion; readonly receipt: string }
	| { readonly outcome: "rejected"; readonly reason: "invalid_artifact_lease" | "artifact_body_exceeds_lease" | "expired_artifact_lease" }
	| { readonly outcome: "deadline_exceeded" };

/** Storage-neutral byte authority. OpenCrane owns leases, receipts, catalog state, and authorization. */
export interface ArtifactStore
{
	/** Hashes and durably stages bytes without publishing a catalog reference. */
	stage(command: StageArtifactCommand): Promise<StagedArtifact>;
	/** Atomically promotes staged bytes to their immutable content address. */
	promote(staged: StagedArtifact): Promise<ArtifactStorePromotion>;
	/** Reads canonical bytes by an already-authorized immutable content address. */
	read(contentAddress: string): Promise<ArtifactByteStream | null>;
	/** Removes bytes only after the OpenCrane authority proved no active lease or reference remains. */
	purge(contentAddress: string): Promise<ArtifactStorePurgeResult>;
}
