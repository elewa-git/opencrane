import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactStorePromotion, StageArtifactCommand, StagedArtifact, VerifiedArtifactWriteLease } from "./artifact-store.types.js";

/**
 * Validates an OpenCrane-issued lease before an adapter creates temporary bytes.
 *
 * Invariant: a lease authorizes exactly one artifact write — it must name a real lease, silo, and
 * artifact, carry the literal `artifact.write` action (a lease minted for any other capability can
 * never authorize a write), and be unexpired at the caller-supplied clock. Any failure means the
 * adapter refuses before a single staging byte is created; there is no partial acceptance.
 */
export function __ValidateVerifiedArtifactWriteLease(lease: VerifiedArtifactWriteLease, nowEpochSeconds: number): boolean
{
	return lease.leaseId.trim().length > 0
		&& lease.siloId.trim().length > 0
		&& lease.artifactId.trim().length > 0
		&& lease.action === "artifact.write"
		&& Number.isSafeInteger(lease.expiresAtEpochSeconds)
		&& lease.expiresAtEpochSeconds >= nowEpochSeconds;
}

/**
 * Validates stage coordinates before untrusted bytes are accepted by an ArtifactStore adapter.
 *
 * Invariant: when the command declares an expected digest or byte length, that declaration must be
 * well-formed (strict `sha256:<hex64>`, safe non-negative integer) so the adapter's byte-for-byte
 * cross-check cannot be sidestepped with a value that parses differently than it compares; the
 * media type must at least be shaped like a MIME type, because it is echoed into the promotion
 * receipt the catalog records. On failure no staging I/O happens at all.
 */
export function __ValidateStageArtifactCommand(command: StageArtifactCommand, nowEpochSeconds: number): boolean
{
	const expectedAddressIsValid = command.expectedContentAddress === null || ___IsSha256ContentAddress(command.expectedContentAddress);
	const expectedLengthIsValid = command.expectedByteLength === null || (Number.isSafeInteger(command.expectedByteLength) && command.expectedByteLength >= 0);
	return __ValidateVerifiedArtifactWriteLease(command.lease, nowEpochSeconds)
		&& expectedAddressIsValid
		&& expectedLengthIsValid
		&& command.mediaType.trim().length > 0
		&& command.mediaType.includes("/");
}

/**
 * Validates a staged handle before immutable promotion.
 *
 * Invariant: promotion may only ever target a strict SHA-256 content address — this check is what
 * keeps a StagedArtifact that crossed the public contract from steering `promote` to an arbitrary
 * filesystem path — and the handle, length, and media type must still describe one complete staged
 * upload. An invalid handle fails closed: nothing is linked, published, or deleted.
 */
export function __ValidateStagedArtifact(staged: StagedArtifact): boolean
{
	return staged.leaseId.trim().length > 0
		&& staged.stagingHandle.trim().length > 0
		&& ___IsSha256ContentAddress(staged.contentAddress)
		&& Number.isSafeInteger(staged.byteLength)
		&& staged.byteLength >= 0
		&& staged.mediaType.trim().length > 0
		&& staged.mediaType.includes("/");
}

/**
 * Validates metadata returned by an idempotent canonical promotion.
 *
 * Invariant: a promotion result must be complete and canonical before it is signed into a receipt
 * or recorded by the catalog — the receipt is the only evidence OpenCrane accepts that bytes exist
 * at an address, so a malformed promotion must never become a signed claim. Fails closed by
 * rejecting the result rather than repairing it.
 */
export function __ValidateArtifactStorePromotion(promotion: ArtifactStorePromotion): boolean
{
	return promotion.leaseId.trim().length > 0
		&& ___IsSha256ContentAddress(promotion.contentAddress)
		&& Number.isSafeInteger(promotion.byteLength)
		&& promotion.byteLength >= 0
		&& promotion.mediaType.trim().length > 0
		&& promotion.mediaType.includes("/");
}
