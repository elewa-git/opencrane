/** Audience accepted only for the isolated malware-scanner workload. */
export const ARTIFACT_SCANNER_PROJECTED_TOKEN_AUDIENCE = "opencrane-artifact-scanner";

/** Fixed ServiceAccount used only by the isolated malware-scanner workload. */
export const ARTIFACT_SCANNER_SERVICE_ACCOUNT_NAME = "artifact-scanner";

/** Retry-stable coordinates for one server-owned artifact scan claim. */
export interface ArtifactScannerClaimCommand
{
	/** Durable scan-job identifier. */
	readonly jobId: string;
	/** Positive claim attempt. */
	readonly attempt: number;
	/** Opaque current fence; stale workers cannot complete newer claims. */
	readonly claimFence: string;
}

/** One bounded source selected by the server for malware scanning. */
export interface ArtifactScannerJobClaim
{
	/** Current claim coordinates. */
	readonly lease: ArtifactScannerClaimCommand & { readonly expiresAt: string };
	/** Exact byte length enforced by the source broker. */
	readonly sourceByteLength: number;
}

/** Stable scanner outcomes accepted by the server authority. */
export enum ArtifactScannerVerdict
{
	/** No malware signature matched the complete source. */
	Clean = "clean",
	/** The complete source matched one or more malware signatures. */
	Rejected = "rejected"
}

/** Worker result without signature names or local filesystem details. */
export interface ArtifactScannerResultCommand extends ArtifactScannerClaimCommand
{
	/** Public safety outcome. */
	readonly verdict: ArtifactScannerVerdict;
	/** Pinned scanner engine and definition version. */
	readonly scannerVersion: string;
}

/** Bounded scanner-side failures eligible for server retry policy. */
export interface ArtifactScannerFailureCommand extends ArtifactScannerClaimCommand
{
	/** Stable failure category without technical or secret-bearing detail. */
	readonly failureCode: "source_read_failed" | "scanner_failed";
}
