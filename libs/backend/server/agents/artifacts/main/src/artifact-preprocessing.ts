import type { ArtifactPreprocessorFailureCommand, ArtifactPreprocessorJobClaim } from "@opencrane/contracts";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactPreprocessCompletionRequest, ArtifactPreprocessOutputLeaseProjection, ArtifactPreprocessOutputLeaseRequest, ArtifactPreprocessRepository, FailArtifactPreprocessJobResult } from "./artifact-preprocessing.types.js";

/** Claims one PDF conversion job without exposing any storage coordinate or capability. */
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

/** Binds server-observed text bytes to the live claim without returning the lease to the worker. */
export async function __IssueArtifactPreprocessOutputLease(repository: ArtifactPreprocessRepository, command: ArtifactPreprocessOutputLeaseRequest): Promise<ArtifactPreprocessOutputLeaseProjection | "completed" | null>
{
	if (!_IsValidOutputLeaseCommand(command)) return null;
	const result = await repository.issueOutputLeaseAtomically(command);
	if (result.status === "completed") return "completed";
	return result.status === "issued" ? result.lease : null;
}

/** Completes one active preprocessing claim after app composition verifies the service receipt. */
export async function __CompleteArtifactPreprocessJob(repository: ArtifactPreprocessRepository, command: ArtifactPreprocessCompletionRequest): Promise<boolean>
{
	const result = await repository.completeAtomically(command);
	return result.status === "completed";
}

/** Applies server-owned retry policy to one bounded worker failure under its current fence. */
export async function __FailArtifactPreprocessJob(repository: ArtifactPreprocessRepository, command: ArtifactPreprocessorFailureCommand): Promise<FailArtifactPreprocessJobResult>
{
	return repository.failAtomically(command);
}

/** Require bounded exact text-output coordinates before consulting durable authority state. */
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
