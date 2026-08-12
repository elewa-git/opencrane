import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactStorePromotion, StageArtifactCommand, StagedArtifact, VerifiedArtifactWriteLease } from "./artifact-store.types.js";

/**
 * Whether a verified lease's fields are usable for staging: non-blank ids, the write action, and an
 * expiry not in the past.
 *
 * A shape check, not a signature check — {@link __VerifyArtifactWriteLease} does that. Passing this
 * does not mean the lease is authentic.
 *
 * No caller outside this package's tests yet.
 * @param lease - The already-verified lease.
 * @param nowEpochSeconds - Current time.
 * @returns True only when every field is usable.
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

/** Whether a stage command is usable: its lease passes {@link __ValidateVerifiedArtifactWriteLease}, any expected address and length are well formed, and the media type contains a slash. */
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

/** Whether a staged object is safe to promote: a well-formed content address, a non-negative byte length, and a non-empty staging handle. */
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

/** Whether a promotion result is well formed, so a faulty adapter cannot cause a catalog revision to be recorded against bad metadata. */
export function __ValidateArtifactStorePromotion(promotion: ArtifactStorePromotion): boolean
{
	return promotion.leaseId.trim().length > 0
		&& ___IsSha256ContentAddress(promotion.contentAddress)
		&& Number.isSafeInteger(promotion.byteLength)
		&& promotion.byteLength >= 0
		&& promotion.mediaType.trim().length > 0
		&& promotion.mediaType.includes("/");
}
