/** What an upload lease permits. Sign it with {@link __SignArtifactWriteLease}; artifact-service is the only intended audience, so it must never be handed to a third party. */
export interface ArtifactWriteLeaseClaims
{
	readonly leaseId: string;
	readonly siloId: string;
	readonly artifactId: string;
	readonly action: "artifact.write";
	readonly expiresAtEpochSeconds: number;
	readonly expectedContentAddress: string | null;
	readonly expectedByteLength: number | null;
	readonly mediaType: string;
}

/** What a read lease permits: exactly one revision's bytes, at one content address, with one media type. It expires within five minutes of issue. */
export interface ArtifactReadLeaseClaims
{
	/** Unique server-issued correlation value for this exact read. */
	readonly leaseId: string;
	/** Silo that owns both the catalog row and immutable bytes. */
	readonly siloId: string;
	/** Logical artifact identity fixed by the server-side authority. */
	readonly artifactId: string;
	/** Exact immutable artifact revision the caller may read. */
	readonly artifactRevisionId: string;
	/** Canonical content address that artifact-service must stream. */
	readonly contentAddress: string;
	/** Exact canonical byte length that artifact-service must expose. */
	readonly byteLength: number;
	/** Media type fixed with the immutable revision. */
	readonly mediaType: string;
	/** Always `artifact.read`. It is what stops a read lease being accepted where a write lease is required. */
	readonly action: "artifact.read";
	/** Absolute Unix expiry; consumers fail closed after it. */
	readonly expiresAtEpochSeconds: number;
}

/** artifact-service's proof that bytes are durably stored. OpenCrane verifies it before recording a catalog revision, so a revision can never point at bytes that were never written. */
export interface ArtifactPromotionReceiptClaims
{
	readonly leaseId: string;
	readonly contentAddress: string;
	readonly byteLength: number;
	readonly mediaType: string;
	readonly issuedAtEpochSeconds: number;
}
