import type { ArtifactPromotionProtocolConfig, ArtifactPromotionLeaseVerifier, ArtifactStore, BoundedArtifactUploadByteSource, PromoteArtifactUploadResult } from "./artifact-store.types.js";

/** Promotes one verified, bounded artifact upload and creates its catalog-consumable receipt. */
export async function __PromoteArtifactUpload(store: ArtifactStore, leaseVerifier: ArtifactPromotionLeaseVerifier, byteSource: BoundedArtifactUploadByteSource, config: ArtifactPromotionProtocolConfig): Promise<PromoteArtifactUploadResult>
{
	// 1. Verify the caller's compact lease before consuming or staging any untrusted request bytes.
	const nowEpochMilliseconds = config.nowEpochMilliseconds();
	const lease = byteSource.compactLease === null ? null : leaseVerifier.verify(byteSource.compactLease, Math.floor(nowEpochMilliseconds / 1_000));
	if (lease === null || lease.expectedContentAddress === null || lease.expectedByteLength === null)
	{
		return { outcome: "rejected", reason: "invalid_artifact_lease" };
	}

	// 2. Reject a malformed or oversized declared body before the adapter starts durable byte I/O.
	if (!_declaredByteLengthIsWithinLease(byteSource.declaredByteLength, lease.expectedByteLength))
	{
		return { outcome: "rejected", reason: "artifact_body_exceeds_lease" };
	}

	// 3. Bound the whole stage-to-promote sequence by both process policy and lease expiry.
	const maximumLeaseDuration = (lease.expiresAtEpochSeconds * 1_000) - nowEpochMilliseconds;
	const maximumUploadDuration = Math.min(config.maxUploadDurationMilliseconds, maximumLeaseDuration);
	if (maximumUploadDuration < 1)
	{
		return { outcome: "rejected", reason: "expired_artifact_lease" };
	}
	let deadlineExceeded = false;
	const deadline = setTimeout(function _abortDeadlineExceeded()
	{
		deadlineExceeded = true;
		byteSource.abort(new Error("artifact upload exceeded its absolute lease-bound deadline"));
	}, maximumUploadDuration);
	try
	{
		const staged = await store.stage({ lease, bytes: byteSource.bytes, expectedContentAddress: lease.expectedContentAddress, expectedByteLength: lease.expectedByteLength, mediaType: lease.mediaType });
		if (_deadlineExceeded(deadlineExceeded, lease.expiresAtEpochSeconds, config.nowEpochMilliseconds())) return { outcome: "deadline_exceeded" };
		const promotion = await store.promote(staged);
		if (_deadlineExceeded(deadlineExceeded, lease.expiresAtEpochSeconds, config.nowEpochMilliseconds())) return { outcome: "deadline_exceeded" };
		const receipt = config.receiptSigner.sign({ leaseId: promotion.leaseId, contentAddress: promotion.contentAddress, byteLength: promotion.byteLength, mediaType: promotion.mediaType, issuedAtEpochSeconds: Math.floor(config.nowEpochMilliseconds() / 1_000) });
		return { outcome: "promoted", promotion, receipt };
	}
	finally
	{
		clearTimeout(deadline);
	}
}

/** Checks the transport declaration without trusting absent or malformed lengths. */
function _declaredByteLengthIsWithinLease(declaredByteLength: string | null, expectedByteLength: number): boolean
{
	if (declaredByteLength === null) return true;
	return /^\d+$/u.test(declaredByteLength) && Number(declaredByteLength) <= expectedByteLength;
}

/** Prevents a receipt after either timer delivery or wall-clock expiry at a protocol boundary. */
function _deadlineExceeded(deadlineExceeded: boolean, leaseExpiresAtEpochSeconds: number, nowEpochMilliseconds: number): boolean
{
	return deadlineExceeded || nowEpochMilliseconds >= leaseExpiresAtEpochSeconds * 1_000;
}
