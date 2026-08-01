/** Sole projected-token audience accepted from the artifact preprocessor worker. */
export const ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE = "opencrane-artifact-preprocessor";

/** Exact Kubernetes ServiceAccount allowed to claim and complete artifact preprocessing work. */
export const ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME = "artifact-preprocessor";

/** Opaque durable claim coordinates that fence one preprocessing worker attempt. */
export interface ArtifactPreprocessorJobLease
{
	/** Durable preprocessing job identifier. */
	readonly jobId: string;
	/** Monotonic job attempt number. */
	readonly attempt: number;
	/** Server-generated fence that changes for every claim. */
	readonly claimFence: string;
	/** UTC instant after which this worker may no longer report a result. */
	readonly expiresAt: string;
}

/** Source metadata needed to bound one conversion without exposing storage authority. */
export interface ArtifactPreprocessorJobClaim
{
	/** Fenced claim that must accompany every later worker call. */
	readonly lease: ArtifactPreprocessorJobLease;
	/** Canonical PDF media type; this worker accepts only application/pdf. */
	readonly sourceMediaType: "application/pdf";
	/** Exact source byte length used to enforce the worker resource limit. */
	readonly sourceByteLength: number;
}

/** Exact live-claim coordinates presented when reading source bytes or submitting output. */
export interface ArtifactPreprocessorClaimCommand
{
	/** Durable job identifier returned by the claim endpoint. */
	readonly jobId: string;
	/** Current claim attempt returned by the claim endpoint. */
	readonly attempt: number;
	/** Current claim fence returned by the claim endpoint. */
	readonly claimFence: string;
}

/** Bounded failure categories a worker may report for its current attempt. */
export type ArtifactPreprocessorFailureCode = "source_read_failed" | "conversion_failed" | "output_submission_failed";

/** Failure evidence reported without exposing an exception, path, or storage coordinate. */
export interface ArtifactPreprocessorFailureCommand extends ArtifactPreprocessorClaimCommand
{
	/** Stable bounded failure category used by server-owned retry policy. */
	readonly failureCode: ArtifactPreprocessorFailureCode;
}
