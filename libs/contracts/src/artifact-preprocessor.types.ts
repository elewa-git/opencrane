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

/** Source bytes and output identity safely exposed to the authenticated PDF worker. */
export interface ArtifactPreprocessorJobClaim
{
	/** Fenced claim that must accompany every later worker call. */
	readonly lease: ArtifactPreprocessorJobLease;
	/** Immutable source revision identifier. */
	readonly sourceRevisionId: string;
	/** Exact source CAS address, included only to bind the signed read lease to the response. */
	readonly sourceContentAddress: string;
	/** Canonical PDF media type; this v1 worker accepts only `application/pdf`. */
	readonly sourceMediaType: "application/pdf";
	/** Exact source byte length used to enforce the worker resource limit. */
	readonly sourceByteLength: number;
	/** Server-allocated generated Artifact that will own the derived text revision. */
	readonly derivedArtifactId: string;
	/** Signed, short-lived read permission for exactly the source CAS address. */
	readonly sourceReadLease: string;
}

/** Worker request for a lease after it has deterministically extracted and hashed the PDF text. */
export interface ArtifactPreprocessorOutputLeaseCommand
{
	/** Durable job identifier returned by the claim endpoint. */
	readonly jobId: string;
	/** Current claim attempt returned by the claim endpoint. */
	readonly attempt: number;
	/** Current claim fence returned by the claim endpoint. */
	readonly claimFence: string;
	/** SHA-256 content address of the exact extracted UTF-8 text bytes. */
	readonly contentAddress: string;
	/** Exact extracted UTF-8 text byte length. */
	readonly byteLength: number;
}

/** Server-authorized upload coordinates for one derived text revision. */
export interface ArtifactPreprocessorOutputLease
{
	/** Fenced claim that remains required for final receipt consumption. */
	readonly lease: ArtifactPreprocessorJobLease;
	/** Server-generated revision identity; the worker may not choose it. */
	readonly derivedRevisionId: string;
	/** Signed exact-byte artifact write permission presented directly to artifact-service. */
	readonly artifactWriteLease: string;
}

/** Worker request to consume an artifact-service promotion receipt under its active claim. */
export interface ArtifactPreprocessorCompletionCommand
{
	/** Durable job identifier returned by the claim endpoint. */
	readonly jobId: string;
	/** Current claim attempt returned by the claim endpoint. */
	readonly attempt: number;
	/** Current claim fence returned by the claim endpoint. */
	readonly claimFence: string;
	/** Server-generated derived revision identity returned by the output-lease endpoint. */
	readonly derivedRevisionId: string;
	/** Artifact-service signed receipt proving the exact derived bytes reached the CAS. */
	readonly promotionReceipt: string;
}
