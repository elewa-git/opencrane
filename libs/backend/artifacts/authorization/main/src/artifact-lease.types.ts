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

/** Signed artifact-service receipt that OpenCrane verifies before catalog finalization. */
export interface ArtifactPromotionReceiptClaims
{
	readonly leaseId: string;
	readonly contentAddress: string;
	readonly byteLength: number;
	readonly mediaType: string;
	readonly issuedAtEpochSeconds: number;
}
