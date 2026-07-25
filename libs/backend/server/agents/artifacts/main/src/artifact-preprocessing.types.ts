import type { ArtifactPromotionReceiptClaims, ArtifactReadLeaseClaims, ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";

/** Immutable source and generated-output coordinates selected only by the catalog authority. */
export interface ArtifactPreprocessClaimProjection
{
	/** Catalog Artifact that owns the source revision and read lease. */
	readonly sourceArtifactId: string;
	/** Durable preprocessing job identifier. */
	readonly jobId: string;
	/** Monotonic attempt number allocated under the current claim. */
	readonly attempt: number;
	/** Fresh opaque fence that invalidates every previous worker attempt. */
	readonly claimFence: string;
	/** Absolute expiry of every capability returned to this worker. */
	readonly claimExpiresAt: Date;
	/** Immutable PDF source revision identifier. */
	readonly sourceRevisionId: string;
	/** Source artifact silo selected from catalog state. */
	readonly siloId: string;
	/** Exact source PDF content address. */
	readonly sourceContentAddress: string;
	/** Exact PDF source byte length. */
	readonly sourceByteLength: number;
	/** Generated Artifact allocated once for this logical preprocessing job. */
	readonly derivedArtifactId: string;
}

/** Exact worker-supplied output digest that the server may turn into one write lease. */
export interface ArtifactPreprocessOutputLeaseRequest
{
	/** Durable job identifier supplied by the prior claim. */
	readonly jobId: string;
	/** Monotonic attempt number supplied by the prior claim. */
	readonly attempt: number;
	/** Exact fence supplied by the prior claim. */
	readonly claimFence: string;
	/** SHA-256 content address of the worker's extracted UTF-8 text. */
	readonly contentAddress: string;
	/** Exact extracted UTF-8 byte length. */
	readonly byteLength: number;
}

/** Durable exact-byte lease projection that the app signs for artifact-service. */
export interface ArtifactPreprocessOutputLeaseProjection
{
	/** Immutable job identifier. */
	readonly jobId: string;
	/** Current claim attempt. */
	readonly attempt: number;
	/** Current claim fence. */
	readonly claimFence: string;
	/** Generated revision identity reserved by the catalog authority. */
	readonly derivedRevisionId: string;
	/** Exact storage write lease claims. */
	readonly writeLease: ArtifactWriteLeaseClaims;
}

/** Verified receipt and claim coordinates consumed only by the preprocessing completion transaction. */
export interface ArtifactPreprocessCompletionRequest
{
	/** Durable job identifier. */
	readonly jobId: string;
	/** Current claim attempt. */
	readonly attempt: number;
	/** Current claim fence. */
	readonly claimFence: string;
	/** Server-reserved generated revision identifier. */
	readonly derivedRevisionId: string;
	/** Artifact-service verified promotion evidence. */
	readonly promotion: ArtifactPromotionReceiptClaims;
	/** SHA-256 digest of the compact signed promotion receipt. */
	readonly receiptDigest: string;
}

/** Result of selecting one durable preprocessing job. */
export type ClaimNextArtifactPreprocessJobResult = { readonly status: "claimed"; readonly claim: ArtifactPreprocessClaimProjection } | { readonly status: "none" };

/** Result of binding extracted bytes to the live job attempt. */
export type IssueArtifactPreprocessOutputLeaseResult = { readonly status: "issued"; readonly lease: ArtifactPreprocessOutputLeaseProjection } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "invalid_output" };

/** Result of atomically publishing one preprocessed text revision. */
export type CompleteArtifactPreprocessJobResult = { readonly status: "completed" } | { readonly status: "conflict"; readonly reason: "claim_not_found" | "stale_claim" | "invalid_receipt" | "receipt_consumed" };

/** Catalog persistence authority for the dedicated PDF preprocessing worker. */
export interface ArtifactPreprocessRepository
{
	/** Claims one eligible PDF job, allocating a fresh fence and generated Artifact. */
	claimNextAtomically(): Promise<ClaimNextArtifactPreprocessJobResult>;
	/** Attaches one exact, short-lived artifact write lease to the live claim. */
	issueOutputLeaseAtomically(request: ArtifactPreprocessOutputLeaseRequest): Promise<IssueArtifactPreprocessOutputLeaseResult>;
	/** Finalizes the verified receipt, immutable derived revision, source lineage, and job together. */
	completeAtomically(request: ArtifactPreprocessCompletionRequest): Promise<CompleteArtifactPreprocessJobResult>;
}

/** Cryptographic capability shapes issued by the application composition boundary. */
export interface ArtifactPreprocessCapabilitySigner
{
	/** Signs a narrow, expiring source-read lease for artifact-service. */
	signReadLease(claims: ArtifactReadLeaseClaims): string;
	/** Signs a narrow, expiring exact-byte output-write lease for artifact-service. */
	signWriteLease(claims: ArtifactWriteLeaseClaims): string;
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

/** Receipt verifier confined to the server process that mounts the receipt public key. */
export interface ArtifactPreprocessorReceiptVerifier
{
	/** Verifies one compact ArtifactStore receipt before catalog completion. */
	verifyReceipt(compact: string): ArtifactPromotionReceiptClaims | null;
	/** Hashes a verified compact receipt for its one durable replay reservation. */
	digestReceipt(compact: string): string;
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
	/** Durable catalog state authority. */
	readonly repository: ArtifactPreprocessRepository;
	/** Source-read and output-write lease signer. */
	readonly signer: ArtifactPreprocessCapabilitySigner;
	/** ArtifactStore receipt verifier and digestor. */
	readonly receipts: ArtifactPreprocessorReceiptVerifier;
	/** Process logger for unavailable-authority failures. */
	readonly logger: ArtifactPreprocessorLogger;
}
