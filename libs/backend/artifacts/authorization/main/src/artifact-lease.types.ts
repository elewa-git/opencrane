/** Signed, short-lived internal lease consumed only by artifact-service. */
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

/** Signed, short-lived internal lease authorising one immutable artifact read. */
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
	/** Separates immutable reads from write-lease authority. */
	readonly action: "artifact.read";
	/** Absolute Unix expiry; consumers fail closed after it. */
	readonly expiresAtEpochSeconds: number;
}

/** Signed artifact-service receipt that OpenCrane verifies before catalog finalization. */
export interface ArtifactPromotionReceiptClaims
{
	readonly leaseId: string;
	readonly contentAddress: string;
	readonly byteLength: number;
	readonly mediaType: string;
	readonly issuedAtEpochSeconds: number;
}
