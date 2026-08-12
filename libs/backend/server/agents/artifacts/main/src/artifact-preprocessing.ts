import type { ArtifactPreprocessorFailureCommand, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseProjection, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, FailArtifactPreprocessJobResult } from "./artifact-preprocessing.types.js";

/**
 * Take the next PDF conversion job and return only what the worker is allowed to know.
 *
 * The repository selects and fences the job; this trims the result down to the fenced claim, the
 * fixed media type, and the source size. Everything else the database returned - the silo, the
 * source artifact and revision ids - is dropped here, which is why the worker cannot name a
 * revision or reach storage on its own.
 *
 * Called by: the `POST /jobs:claim` handler in artifact-preprocessing.router.ts.
 *
 * @param repository - The preprocessing repository, one transaction per call.
 * @returns The claim to send to the worker, or null when no job is ready, which the router
 *   answers as HTTP 204 so the worker keeps polling.
 * @throws Whatever the repository throws, including when a stored source size is too large to
 *   represent exactly in JavaScript. The router logs it and answers 503.
 */
export async function __ClaimArtifactPreprocessJob(repository: ArtifactPreprocessRepository): Promise<ArtifactPreprocessorJobClaim | null>
{
	const result = await repository.claimNextAtomically();
	if (result.status === "none") return null;
	const claim = result.claim;
	return {
		lease: { jobId: claim.jobId, attempt: claim.attempt, claimFence: claim.claimFence, expiresAt: claim.claimExpiresAt.toISOString() },
		sourceMediaType: "application/pdf",
		sourceByteLength: claim.sourceByteLength,
	};
}

/**
 * Reserve write permission for text the server has already received and hashed.
 *
 * Checks the request's shape first so a malformed submission never reaches the database, then
 * asks the repository to attach a write lease to the live claim. The returned lease is for
 * server use only; the caller signs it, promotes the bytes, and completes the job.
 *
 * Called by: `_CreateArtifactPreprocessOutputBroker` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts.
 *
 * @param repository - The preprocessing repository, one transaction per call.
 * @param command - The claim plus the server-computed content address and byte length.
 * @returns The write lease and reserved revision id to promote with; `"completed"` when this
 *   exact output was already published on this attempt, so the caller should report success
 *   without promoting again; or null when the input failed validation or the claim is no longer
 *   current, which the caller reports as a conflict.
 */
export async function __IssueArtifactPreprocessOutputLease(repository: ArtifactPreprocessRepository, command: ArtifactPreprocessOutputLeaseRequest): Promise<ArtifactPreprocessOutputLeaseProjection | "completed" | null>
{
	if (!_IsValidOutputLeaseCommand(command)) return null;
	const result = await repository.issueOutputLeaseAtomically(command);
	if (result.status === "completed") return "completed";
	return result.status === "issued" ? result.lease : null;
}

/**
 * Commit the converted text once its promotion receipt has been verified.
 *
 * Called only after the app-side broker has promoted the bytes and checked the receipt
 * signature. The repository re-checks the receipt against the stored lease row, so a receipt for
 * a different lease, size, or media type cannot publish anything.
 *
 * Called by: `_CreateArtifactPreprocessOutputBroker` in
 * apps/opencrane/src/infra/artifacts/artifact-upload.factory.ts.
 *
 * @param repository - The preprocessing repository, one transaction per call.
 * @param command - The claim, reserved revision id, verified receipt, and receipt digest.
 * @returns True when the revision is published, including when this repeats a completion that
 *   already succeeded. False means nothing was published and the caller must report a conflict;
 *   the bytes stay in storage unreferenced rather than being deleted here.
 */
export async function __CompleteArtifactPreprocessJob(repository: ArtifactPreprocessRepository, command: ArtifactPreprocessCompletionRequest): Promise<boolean>
{
	const result = await repository.completeAtomically(command);
	return result.status === "completed";
}

/**
 * Record that an attempt failed and let the server decide whether the job runs again.
 *
 * The worker only says which step broke. Whether that becomes a retry with a wait or a permanent
 * failure is the server's call, so a misbehaving worker cannot keep a job cycling or bury it.
 *
 * Called by: the `PUT /jobs/:jobId/failure` handler in artifact-preprocessing.router.ts.
 *
 * @param repository - The preprocessing repository, one transaction per call.
 * @param command - The claim plus one of the three allowed failure codes.
 * @returns `retryable`, `terminal`, or `conflict` when the report no longer matches the live
 *   claim. The router answers 204 for the first two and 409 for the third.
 */
export async function __FailArtifactPreprocessJob(repository: ArtifactPreprocessRepository, command: ArtifactPreprocessorFailureCommand): Promise<FailArtifactPreprocessJobResult>
{
	return repository.failAtomically(command);
}

/** Check the job id, attempt, fence, content address, and byte length are well formed before touching the database. */
function _IsValidOutputLeaseCommand(command: ArtifactPreprocessOutputLeaseRequest): boolean
{
	return command.jobId.trim().length > 0
		&& Number.isSafeInteger(command.attempt)
		&& command.attempt > 0
		&& command.claimFence.trim().length > 0
		&& ___IsSha256ContentAddress(command.contentAddress)
		&& Number.isSafeInteger(command.byteLength)
		&& command.byteLength >= 0;
}
