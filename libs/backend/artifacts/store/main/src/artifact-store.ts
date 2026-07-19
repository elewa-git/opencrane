import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactStorePromotion, StageArtifactCommand, StagedArtifact, VerifiedArtifactWriteLease } from "./artifact-store.types.js";

/**
 * Validates an OpenCrane-issued lease before an adapter creates temporary bytes.
 *
 * Invariant: a lease authorizes exactly one `artifact.write` for one silo and artifact and must be
 * unexpired at the supplied clock. Any failure rejects before a single staging byte is created.
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
 * Invariant: declared digest and length must be strictly shaped so the adapter's byte-for-byte
 * cross-check cannot be bypassed with an ambiguously parsed value. Failure performs no staging I/O.
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
 * Invariant: promotion can target only a strict content address, preventing a public handle from
 * steering the filesystem adapter to an arbitrary path. Invalid metadata never links or deletes.
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
 * Invariant: only complete canonical metadata may be signed into a receipt or committed by the
 * catalog authority; malformed promotion output is rejected rather than repaired.
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
