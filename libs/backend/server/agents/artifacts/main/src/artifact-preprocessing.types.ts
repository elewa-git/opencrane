import type { ArtifactPromotionReceiptClaims, ArtifactReadLeaseClaims, ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";
import type { ArtifactPreprocessorClaimCommand, ArtifactPreprocessorFailureCommand } from "@opencrane/contracts";

/** Immutable source and generated-output coordinates selected only by the catalogue authority. */
export interface ArtifactPreprocessClaimProjection
{
	/** Durable preprocessing job identifier. */
	readonly jobId: string;
	/** Monotonic attempt number allocated under the current claim. */
	readonly attempt: number;
	/** Fresh opaque fence that invalidates every previous worker attempt. */
	readonly claimFence: string;
	/** Absolute expiry of every operation admitted for this worker. */
	readonly claimExpiresAt: Date;
	/** Source artifact silo selected from catalogue state. */
	readonly siloId: string;
	/** Logical source artifact selected from catalogue state. */
	readonly sourceArtifactId: string;
	/** Immutable PDF source revision identifier. */
	readonly sourceRevisionId: string;
	/** Exact PDF source byte length used only to bound worker resource use. */
	readonly sourceByteLength: number;
}

/** Exact read lease facts allocated under the current claim transaction. */
export interface ArtifactPreprocessSourceLeaseProjection
{
	/** Read authority whose expiry never exceeds the current claim deadline. */
	readonly readLease: ArtifactReadLeaseClaims;
	/** Exact source length used to cross-check the broker response. */
	readonly byteLength: number;
	/** Fixed source media type admitted by this pipeline. */
	readonly mediaType: "application/pdf";
}

/** Exact server-observed output digest that may become one internal write lease. */
export interface ArtifactPreprocessOutputLeaseRequest extends ArtifactPreprocessorClaimCommand
{
	/** SHA-256 content address computed from the bounded submitted text bytes. */
	readonly contentAddress: string;
	/** Exact submitted UTF-8 text byte length. */
	readonly byteLength: number;
}

/** Durable exact-byte lease projection that app composition signs internally. */
export interface ArtifactPreprocessOutputLeaseProjection
{
	/** Immutable job identifier. */
	readonly jobId: string;
	/** Current claim attempt. */
	readonly attempt: number;
	/** Current claim fence. */
	readonly claimFence: string;
	/** Server-generated revision identity reserved by the catalogue authority. */
	readonly derivedRevisionId: string;
	/** Exact storage write lease claims that never cross into the worker. */
	readonly writeLease: ArtifactWriteLeaseClaims;
}

/** Verified receipt and claim coordinates consumed only by the completion transaction. */
export interface ArtifactPreprocessCompletionRequest extends ArtifactPreprocessorClaimCommand
{
	/** Server-reserved generated revision identifier. */
	readonly derivedRevisionId: string;
	/** Artifact-service verified promotion evidence. */
	readonly promotion: ArtifactPromotionReceiptClaims;
	/** SHA-256 digest of the compact signed receipt for durable replay fencing. */
	readonly receiptDigest: string;
}

/** Result of selecting one durable preprocessing job. */
export type ClaimNextArtifactPreprocessJobResult = { readonly status: "claimed"; readonly claim: ArtifactPreprocessClaimProjection } | { readonly status: "none" };

/** Result of binding extracted bytes to the live job attempt. */
export type IssueArtifactPreprocessOutputLeaseResult = { readonly status: "issued"; readonly lease: ArtifactPreprocessOutputLeaseProjection } | { readonly status: "completed" } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "invalid_output" };

/** Result of atomically publishing one preprocessed text revision. */
export type CompleteArtifactPreprocessJobResult = { readonly status: "completed" } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "invalid_receipt" | "receipt_consumed" };

/** Result of applying the server-owned retry ceiling to one current failed attempt. */
export type FailArtifactPreprocessJobResult = { readonly status: "retryable" | "terminal" } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" };

/** Narrow issuer that freezes one current preprocessing source lease. */
export interface ArtifactPreprocessSourceLeaseIssuer
{
	/** Allocates exact source-read facts only while the supplied attempt and fence remain current. */
	issueSourceLeaseAtomically(command: ArtifactPreprocessorClaimCommand): Promise<ArtifactPreprocessSourceLeaseProjection | null>;
}

/** Catalogue persistence authority for the dedicated PDF preprocessing worker. */
export interface ArtifactPreprocessRepository extends ArtifactPreprocessSourceLeaseIssuer
{
	/** Claims one eligible PDF job, allocating a fresh fence and generated Artifact. */
	claimNextAtomically(): Promise<ClaimNextArtifactPreprocessJobResult>;
	/** Attaches one exact, short-lived artifact write lease to the live claim. */
	issueOutputLeaseAtomically(request: ArtifactPreprocessOutputLeaseRequest): Promise<IssueArtifactPreprocessOutputLeaseResult>;
	/** Finalizes the verified receipt, immutable derived revision, source lineage, and job together. */
	completeAtomically(request: ArtifactPreprocessCompletionRequest): Promise<CompleteArtifactPreprocessJobResult>;
	/** Records a bounded failure under the current fence and applies retry or terminal policy. */
	failAtomically(command: ArtifactPreprocessorFailureCommand): Promise<FailArtifactPreprocessJobResult>;
}

/** TokenReview-confirmed identity of the sole artifact-preprocessor Kubernetes workload. */
export interface ReviewedArtifactPreprocessorIdentity
{
	/** Exact Kubernetes username returned by TokenReview. */
	readonly username: string;
	/** Namespace returned by the reviewed ServiceAccount subject. */
	readonly namespace: string;
	/** ServiceAccount name returned by TokenReview. */
	readonly serviceAccountName: string;
	/** Audiences accepted by the Kubernetes API server. */
	readonly audiences: readonly string[];
}

/** App-owned TokenReview adapter for the dedicated preprocessing workload identity. */
export interface ArtifactPreprocessorTokenReviewer
{
	/** Reviews one presented projected ServiceAccount token. */
	__Review(token: string): Promise<ReviewedArtifactPreprocessorIdentity | null>;
}

/** Server-brokered immutable source bytes that expose no storage coordinate or capability. */
export interface ArtifactPreprocessSourceRead
{
	/** Exact length cross-checked against both job and read-lease catalogue facts. */
	readonly byteLength: number;
	/** Fixed media type cross-checked against both job and read-lease catalogue facts. */
	readonly mediaType: "application/pdf";
	/** Private artifact-service response body streamed through OpenCrane. */
	readonly bytes: AsyncIterable<Uint8Array>;
}

/** App-composed source broker backed by the one generic catalogue read issuer. */
export interface ArtifactPreprocessSourceBroker
{
	/** Reads bytes only while the supplied attempt and fence remain current. */
	read(command: ArtifactPreprocessorClaimCommand): Promise<ArtifactPreprocessSourceRead | null>;
}

/** App-composed output broker that keeps leases and receipts inside trusted server processes. */
export interface ArtifactPreprocessOutputBroker
{
	/** Bounds, hashes, promotes, verifies, and completes one submitted output body. */
	publish(command: ArtifactPreprocessorClaimCommand, bytes: AsyncIterable<Uint8Array>): Promise<"completed" | "conflict">;
}

/** Minimal structured logger surface for the private preprocessor HTTP boundary. */
export interface ArtifactPreprocessorLogger
{
	/** Records one infrastructure failure without serialising credentials or request bodies. */
	error(bindings: { readonly err: unknown; readonly operation: string }, message: string): void;
}

/** Dependencies of the workload-authenticated preprocessing router. */
export interface ArtifactPreprocessorRouterDependencies
{
	/** Fixed projected-token identity reviewer. */
	readonly tokenReviewer: ArtifactPreprocessorTokenReviewer;
	/** Exact namespace containing the preprocessing ServiceAccount. */
	readonly namespace: string;
	/** Durable catalogue state authority. */
	readonly repository: ArtifactPreprocessRepository;
	/** Source-byte broker that keeps the read lease and storage endpoint private. */
	readonly sourceBroker: ArtifactPreprocessSourceBroker;
	/** Output-byte broker that keeps the write lease and promotion receipt private. */
	readonly outputBroker: ArtifactPreprocessOutputBroker;
	/** Process logger for unavailable-authority failures. */
	readonly logger: ArtifactPreprocessorLogger;
}
