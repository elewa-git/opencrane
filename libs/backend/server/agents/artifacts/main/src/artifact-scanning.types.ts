import type { ArtifactScannerFailureCommand, ArtifactScannerJobClaim, ArtifactScannerResultCommand } from "@opencrane/contracts";

/** Exact scanner identity accepted after Kubernetes TokenReview. */
export interface ReviewedArtifactScannerIdentity { readonly namespace: string; readonly serviceAccountName: string; }

/** TokenReview port for the dedicated scanner identity and audience. */
export interface ArtifactScannerTokenReviewer { review(token: string, audience: string): Promise<ReviewedArtifactScannerIdentity | null>; }

/** Internal source selected from a live scan fence. */
export interface ArtifactScanSourceRead { readonly contentAddress: string; readonly mediaType: string; readonly byteLength: number; }

/** Server-side ArtifactStore reader that never exposes its coordinate to the worker. */
export interface ArtifactScanSourceBroker { open(source: ArtifactScanSourceRead): Promise<AsyncIterable<Uint8Array>>; }

/** Durable scanner authority. */
export interface ArtifactScanRepository
{
	claim(): Promise<ArtifactScannerJobClaim | null>;
	readSource(command: { readonly jobId: string; readonly attempt: number; readonly claimFence: string }): Promise<ArtifactScanSourceRead | null>;
	complete(command: ArtifactScannerResultCommand): Promise<"completed" | "idempotent" | "stale">;
	fail(command: ArtifactScannerFailureCommand): Promise<"failed" | "idempotent" | "stale">;
}

/** Transaction-owning scan lifecycle contract. */
export interface ArtifactScanUnitOfWork extends ArtifactScanRepository {}

/** Dependencies for the private scanner router. */
export interface ArtifactScannerRouterDependencies
{
	readonly authority: ArtifactScanRepository;
	readonly tokenReviewer: ArtifactScannerTokenReviewer;
	readonly sourceBroker: ArtifactScanSourceBroker;
	readonly expectedNamespace: string;
	readonly logger: { error(value: object, message: string): void };
}
