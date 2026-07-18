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
