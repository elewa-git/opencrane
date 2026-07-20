import type { ArtifactPromotionReceiptClaims, ArtifactWriteLeaseClaims } from "@opencrane/backend/artifacts/authorization";

/** Already proof-authorized artifact upload request. Proof verification/replay reservation happens before this use case. */
export interface VerifiedArtifactUploadCommand
{
	readonly artifactId: string;
	readonly siloId: string;
	readonly capabilityJti: string;
	readonly expectedContentAddress: string;
	readonly expectedByteLength: number;
	readonly mediaType: string;
	readonly expiresAtEpochSeconds: number;
	readonly createdBy: string;
	readonly revision: number;
	readonly artifactRevisionId: string;
	readonly provenance: Readonly<Record<string, unknown>>;
	readonly idempotencyKey: string;
	readonly bytes: AsyncIterable<Uint8Array>;
}

/** Durable lease writer owned only by the catalog authority. */
export interface ArtifactUploadLeaseRepository
{
	issueLeaseAtomically(command: Omit<VerifiedArtifactUploadCommand, "bytes" | "createdBy" | "revision" | "artifactRevisionId" | "provenance" | "idempotencyKey">): Promise<{ readonly status: "issued"; readonly lease: ArtifactWriteLeaseClaims } | { readonly status: "artifact_not_found" | "conflict" }>;
}

/** Internal HTTP adapter for the private artifact-service boundary. */
export interface ArtifactServicePromotionPort
{
	promote(lease: string, bytes: AsyncIterable<Uint8Array>): Promise<{ readonly receipt: string }>;
}

/** Cryptographic functions injected so the workflow never holds raw key material itself. */
export interface ArtifactUploadCryptoPort
{
	signLease(claims: ArtifactWriteLeaseClaims): string;
	verifyReceipt(compact: string): ArtifactPromotionReceiptClaims | null;
	digestReceipt(compact: string): string;
}

/** Complete verified upload result. */
export type ArtifactUploadResult = { readonly outcome: "finalized"; readonly idempotent: boolean } | { readonly outcome: "denied"; readonly reason: "lease_issue_failed" | "promotion_invalid" | "finalization_failed" };
