import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactStorePromotion, StageArtifactCommand, StagedArtifact, VerifiedArtifactWriteLease } from "./artifact-store.types.js";

/** Validates an OpenCrane-issued lease before an adapter creates temporary bytes. */
export function __ValidateVerifiedArtifactWriteLease(lease: VerifiedArtifactWriteLease, nowEpochSeconds: number): boolean
{
	return lease.leaseId.trim().length > 0
		&& lease.siloId.trim().length > 0
		&& lease.artifactId.trim().length > 0
		&& lease.action === "artifact.write"
		&& Number.isSafeInteger(lease.expiresAtEpochSeconds)
		&& lease.expiresAtEpochSeconds >= nowEpochSeconds;
}

/** Validates stage coordinates before untrusted bytes are accepted by an ArtifactStore adapter. */
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

/** Validates a staged handle before immutable promotion. */
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

/** Validates metadata returned by an idempotent canonical promotion. */
export function __ValidateArtifactStorePromotion(promotion: ArtifactStorePromotion): boolean
{
	return promotion.leaseId.trim().length > 0
		&& ___IsSha256ContentAddress(promotion.contentAddress)
		&& Number.isSafeInteger(promotion.byteLength)
		&& promotion.byteLength >= 0
		&& promotion.mediaType.trim().length > 0
		&& promotion.mediaType.includes("/");
}
