import { randomUUID } from "node:crypto";

import { type ArtifactPreprocessorCompletionCommand, type ArtifactPreprocessorJobClaim, type ArtifactPreprocessorOutputLease, type ArtifactPreprocessorOutputLeaseCommand } from "@opencrane/contracts";
import { ___IsSha256ContentAddress } from "@opencrane/models/artifacts";

import type { ArtifactPreprocessCapabilitySigner, ArtifactPreprocessCompletionRequest, ArtifactPreprocessRepository } from "./artifact-preprocessing.types.js";

/** Claims one PDF conversion job and emits only its exact source-read capability. */
export async function __ClaimArtifactPreprocessJob(repository: ArtifactPreprocessRepository, signer: ArtifactPreprocessCapabilitySigner): Promise<ArtifactPreprocessorJobClaim | null>
{
	const result = await repository.claimNextAtomically();
	if (result.status === "none") return null;
	const claim = result.claim;
	const expiresAtEpochSeconds = Math.floor(claim.claimExpiresAt.getTime() / 1_000);
	return {
		lease: { jobId: claim.jobId, attempt: claim.attempt, claimFence: claim.claimFence, expiresAt: claim.claimExpiresAt.toISOString() },
		sourceRevisionId: claim.sourceRevisionId,
		sourceContentAddress: claim.sourceContentAddress,
		sourceMediaType: "application/pdf",
		sourceByteLength: claim.sourceByteLength,
		derivedArtifactId: claim.derivedArtifactId,
		sourceReadLease: signer.signReadLease({ leaseId: randomUUID(), siloId: claim.siloId, operationId: `${claim.jobId}:${claim.attempt}:${claim.claimFence}`, contentAddress: claim.sourceContentAddress, action: "artifact.read", expiresAtEpochSeconds, mediaType: "application/pdf" }),
	};
}

/** Binds one worker-observed text digest to a current claim and signs the resulting write lease. */
export async function __IssueArtifactPreprocessOutputLease(repository: ArtifactPreprocessRepository, signer: ArtifactPreprocessCapabilitySigner, command: ArtifactPreprocessorOutputLeaseCommand): Promise<ArtifactPreprocessorOutputLease | null>
{
	if (!_IsValidOutputLeaseCommand(command)) return null;
	const result = await repository.issueOutputLeaseAtomically(command);
	if (result.status !== "issued") return null;
	const lease = result.lease;
	return { lease: { jobId: lease.jobId, attempt: lease.attempt, claimFence: lease.claimFence, expiresAt: new Date(lease.writeLease.expiresAtEpochSeconds * 1_000).toISOString() }, derivedRevisionId: lease.derivedRevisionId, artifactWriteLease: signer.signWriteLease(lease.writeLease) };
}

/** Completes one active preprocessing claim after the app has verified the signed service receipt. */
export async function __CompleteArtifactPreprocessJob(repository: ArtifactPreprocessRepository, command: ArtifactPreprocessCompletionRequest): Promise<boolean>
{
	const result = await repository.completeAtomically(command);
	return result.status === "completed";
}

/** Require bounded exact text-output coordinates before consulting durable authority state. */
function _IsValidOutputLeaseCommand(command: ArtifactPreprocessorOutputLeaseCommand): boolean
{
	return command.jobId.trim().length > 0 && Number.isSafeInteger(command.attempt) && command.attempt > 0 && command.claimFence.trim().length > 0 && ___IsSha256ContentAddress(command.contentAddress) && Number.isSafeInteger(command.byteLength) && command.byteLength >= 0;
}
