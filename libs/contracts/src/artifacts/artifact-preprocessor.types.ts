/** Sole projected-token audience accepted from the artifact preprocessor worker. */
export const ARTIFACT_PREPROCESSOR_PROJECTED_TOKEN_AUDIENCE = "opencrane-artifact-preprocessor";

/** Exact Kubernetes ServiceAccount allowed to claim and complete artifact preprocessing work. */
export const ARTIFACT_PREPROCESSOR_SERVICE_ACCOUNT_NAME = "artifact-preprocessor";

/**
 * A worker's claim on one preprocessing job.
 *
 * Every later call must carry `jobId`, `attempt`, and `claimFence` back unchanged; the server
 * rejects a call whose fence is stale, which is what stops a worker that lost its claim from
 * submitting output. After `expiresAt` the worker may no longer report anything at all.
 * @see {@link ArtifactPreprocessorClaimCommand}
 */
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

/** What a worker needs to convert one PDF: its claim, the media type, and the exact source size. It deliberately carries no storage path or credential — bytes come from the OpenCrane broker. */
export interface ArtifactPreprocessorJobClaim
{
	/** Fenced claim that must accompany every later worker call. */
	readonly lease: ArtifactPreprocessorJobLease;
	/** Canonical PDF media type; this worker accepts only application/pdf. */
	readonly sourceMediaType: "application/pdf";
	/** Exact source byte length used to enforce the worker resource limit. */
	readonly sourceByteLength: number;
}

/** The three claim fields a worker must send on every byte-read and output-submit call. @see {@link ArtifactPreprocessorJobLease} */
export interface ArtifactPreprocessorClaimCommand
{
	/** Durable job identifier returned by the claim endpoint. */
	readonly jobId: string;
	/** Current claim attempt returned by the claim endpoint. */
	readonly attempt: number;
	/** Current claim fence returned by the claim endpoint. */
	readonly claimFence: string;
}

/** The only failure reasons a worker may report. The server, not the worker, decides whether the job is retried. */
export type ArtifactPreprocessorFailureCode = "source_read_failed" | "conversion_failed" | "output_submission_failed";

/** A worker's failure report: its claim plus one fixed reason code. It carries no exception text, no filesystem path, and no storage location. */
export interface ArtifactPreprocessorFailureCommand extends ArtifactPreprocessorClaimCommand
{
	/** Stable bounded failure category used by server-owned retry policy. */
	readonly failureCode: ArtifactPreprocessorFailureCode;
}
