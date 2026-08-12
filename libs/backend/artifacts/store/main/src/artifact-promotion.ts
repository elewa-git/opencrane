import type { ArtifactPromotionProtocolConfig, ArtifactPromotionLeaseVerifier, ArtifactStore, BoundedArtifactUploadByteSource, PromoteArtifactUploadResult } from "./artifact-store.types.js";

/**
 * Run one artifact upload end to end: verify the lease, stage the bytes, publish them, and sign a
 * receipt.
 *
 * Never throws for an expected failure — every outcome comes back as a value, so a transport maps
 * {@link PromoteArtifactUploadResult} to a status code. An unbounded lease, one with no expected
 * address or length, is rejected outright: without both, the bytes cannot be checked against what
 * was authorized.
 *
 * The whole sequence is bounded by whichever is sooner, the configured upload duration or the
 * lease expiry. When that deadline passes the byte source is aborted and the result is
 * `deadline_exceeded` — staged bytes may already exist and are left for a later cleanup, and no
 * receipt is signed, so the catalog records nothing.
 *
 * Called by: `apps/artifact-service/src/server.ts`.
 * @param store - Durable byte storage.
 * @param leaseVerifier - Verifies the caller's compact lease.
 * @param byteSource - The lease, declared length, bytes, and the abort hook this protocol calls on deadline.
 * @param config - Maximum upload duration, the injected clock, and the receipt signer.
 * @returns `promoted` with the object and receipt, `rejected` with a stable reason, or `deadline_exceeded`.
 * @see {@link ArtifactStore}
 */
export async function __PromoteArtifactUpload(store: ArtifactStore, leaseVerifier: ArtifactPromotionLeaseVerifier, byteSource: BoundedArtifactUploadByteSource, config: ArtifactPromotionProtocolConfig): Promise<PromoteArtifactUploadResult>
{
	// 1. Verify the caller's compact lease before consuming or staging any untrusted request bytes.
	const nowEpochMilliseconds = config.nowEpochMilliseconds();
	const lease = byteSource.compactLease === null ? null : leaseVerifier.verify(byteSource.compactLease, Math.floor(nowEpochMilliseconds / 1_000));
	if (lease === null || lease.expectedContentAddress === null || lease.expectedByteLength === null)
	{
		return { outcome: "rejected", reason: "invalid_artifact_lease" };
	}

	// 2. If the transport declared a length, reject it now when it is malformed or exceeds the lease — cheaper than discovering it mid-upload. An absent length is allowed; the bytes are still checked later.
	if (!_declaredByteLengthIsWithinLease(byteSource.declaredByteLength, lease.expectedByteLength))
	{
		return { outcome: "rejected", reason: "artifact_body_exceeds_lease" };
	}

	// 3. Deadline for the whole upload: the sooner of the configured limit and the lease expiry.
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

/** Whether a declared content length is acceptable. An absent length passes, since the bytes are bounded again during staging; a non-numeric or oversized one fails. */
function _declaredByteLengthIsWithinLease(declaredByteLength: string | null, expectedByteLength: number): boolean
{
	if (declaredByteLength === null) return true;
	return /^\d+$/u.test(declaredByteLength) && Number(declaredByteLength) <= expectedByteLength;
}

/** Whether the deadline has passed, either because the abort timer fired or because the lease has since expired. Checked after each step so no receipt is signed for a late upload. */
function _deadlineExceeded(deadlineExceeded: boolean, leaseExpiresAtEpochSeconds: number, nowEpochMilliseconds: number): boolean
{
	return deadlineExceeded || nowEpochMilliseconds >= leaseExpiresAtEpochSeconds * 1_000;
}
