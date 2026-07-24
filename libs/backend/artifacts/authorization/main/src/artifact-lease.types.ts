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

/** Signed, short-lived internal lease that permits reading one exact canonical object. */
export interface ArtifactReadLeaseClaims
{
	/** Unique OpenCrane-issued lease identifier for audit correlation. */
	readonly leaseId: string;
	/** Silo in which the source artifact remains authoritative. */
	readonly siloId: string;
	/** Exact catalog artifact whose published revision owns the bytes. */
	readonly artifactId: string;
	/** Exact published catalog revision that approved this immutable content. */
	readonly artifactRevisionId: string;
	/** Exact immutable CAS address that may be read. */
	readonly contentAddress: string;
	/** Exact capability action accepted by artifact-service. */
	readonly action: "artifact.read";
	/** Epoch-second expiry after which the byte stream must not begin. */
	readonly expiresAtEpochSeconds: number;
	/** Exact byte count that artifact-service must stream, never infer from a pathname. */
	readonly byteLength: number;
	/** Catalog-approved media type returned with the canonical bytes. */
	readonly mediaType: string;
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
