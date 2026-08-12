import type { ArtifactReadLeaseClaims } from "@opencrane/backend/artifacts/authorization";
import type { ArtifactScannerFailureCommand, ArtifactScannerJobClaim, ArtifactScannerResultCommand } from "@opencrane/contracts";

/** Exact scanner identity accepted after Kubernetes TokenReview. */
export interface ReviewedArtifactScannerIdentity
{
	/** Full Kubernetes ServiceAccount username returned by TokenReview. */
	readonly username: string;
	/** Namespace fixed by server deployment policy. */
	readonly namespace: string;
	/** ServiceAccount name fixed by server deployment policy. */
	readonly serviceAccountName: string;
	/** Audiences accepted by Kubernetes for the reviewed token. */
	readonly audiences: readonly string[];
}

/** TokenReview port for the dedicated scanner identity and audience. */
export interface ArtifactScannerTokenReviewer
{
	/** Verify a projected token against factory-fixed scanner identity coordinates. */
	__Review(token: string): Promise<ReviewedArtifactScannerIdentity | null>;
}

/** Internal source selected from a live scan fence. */
export interface ArtifactScanSourceRead
{
	/** Exact read authority capped by the current scan claim deadline. */
	readonly readLease: ArtifactReadLeaseClaims;
	/** Exact immutable media type used to cross-check ArtifactStore. */
	readonly mediaType: string;
	/** Exact immutable byte length used to cross-check ArtifactStore. */
	readonly byteLength: number;
}

/** Server-side ArtifactStore reader that never exposes its coordinate to the worker. */
export interface ArtifactScanSourceBroker
{
	/** Sign and consume one server-only read projection without exposing its lease. */
	open(source: ArtifactScanSourceRead): Promise<AsyncIterable<Uint8Array>>;
}

/** Durable scanner authority. */
export interface ArtifactScanRepository
{
	/** Claim one eligible quarantined revision. */
	claim(): Promise<ArtifactScannerJobClaim | null>;
	/** Allocate one exact source read only while the supplied claim fence is live. */
	readSource(command: { readonly jobId: string; readonly attempt: number; readonly claimFence: string }): Promise<ArtifactScanSourceRead | null>;
	/** Publish one complete clean or rejected result under the live fence. */
	complete(command: ArtifactScannerResultCommand): Promise<"completed" | "idempotent" | "stale">;
	/** Record one bounded worker failure under the live fence. */
	fail(command: ArtifactScannerFailureCommand): Promise<"failed" | "idempotent" | "stale">;
}

/** Safe terminal conversation-asset states selected by scanner authority. */
export enum ConversationAssetScanLifecycleStates
{
	/** Safe published bytes are available to current participants. */
	Ready = "ready",
	/** The scan reached a safe terminal failure. */
	Failed = "failed",
}

/** Conversation-owned transaction repository used by the scanner integration unit of work. */
export interface ConversationAssetScanLifecycleRepository
{
	/** Move one processing conversation asset to the scanner-selected safe terminal state. */
	report(command: { readonly revisionId: string; readonly state: ConversationAssetScanLifecycleStates; readonly failureCode: "unsafe_file" | "scan_failed" | null }): Promise<void>;
}

/** Dependencies for the private scanner router. */
export interface ArtifactScannerRouterDependencies
{
	/** Transaction-owning scan lifecycle authority. */
	readonly authority: ArtifactScanRepository;
	/** Fixed projected-token reviewer for the scanner ServiceAccount. */
	readonly tokenReviewer: ArtifactScannerTokenReviewer;
	/** Server-only ArtifactStore byte broker. */
	readonly sourceBroker: ArtifactScanSourceBroker;
	/** Exact isolated namespace admitted by deployment policy. */
	readonly expectedNamespace: string;
	/** Structured logger that never serialises token or byte content. */
	readonly logger: { error(value: object, message: string): void };
}
