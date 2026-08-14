import { randomUUID } from "node:crypto";

import { __IsSafeArtifactMediaType } from "@opencrane/backend/artifacts/authorization";

import { IssueArtifactReadLeaseOutcomes, type ArtifactReadLeaseRepository, type ArtifactReadLeaseSigner, type IssueArtifactReadLeaseCommand, type IssueArtifactReadLeaseResult, type PublishedArtifactReadTarget } from "./artifact-read-lease.types";

/** Maximum lifetime for a service-verified internal artifact read lease. */
const _READ_LEASE_SECONDS = 300;

/** Issue one exact short-lived read lease from independently loaded active catalogue facts. */
export async function __IssueArtifactReadLease(repository: ArtifactReadLeaseRepository, signer: ArtifactReadLeaseSigner, command: IssueArtifactReadLeaseCommand, nowEpochSeconds: number): Promise<IssueArtifactReadLeaseResult>
{
	if (!_IsCommand(command) || !Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0)
	{
		return { outcome: IssueArtifactReadLeaseOutcomes.Denied, reason: "invalid_command" };
	}

	// 1. Reload the exact revision under its silo; no caller byte metadata becomes lease content.
	const target = await repository.loadPublishedReadTarget(command);
	if (!_MatchesCommand(target, command))
	{
		return { outcome: IssueArtifactReadLeaseOutcomes.Denied, reason: "revision_not_readable" };
	}

	// 2. Bind one opaque, bounded lease to the immutable facts returned by the catalogue authority.
	const claims = { leaseId: randomUUID(), siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId, contentAddress: target.contentAddress, byteLength: target.byteLength, mediaType: target.mediaType, action: "artifact.read" as const, expiresAtEpochSeconds: nowEpochSeconds + _READ_LEASE_SECONDS };

	// 3. Only app composition owns the mounted signing key and may serialize the reviewed claims.
	return { outcome: IssueArtifactReadLeaseOutcomes.Issued, compactLease: signer.sign(claims), claims };
}

/** Reject malformed durable coordinates before they can probe the catalogue repository. */
function _IsCommand(value: IssueArtifactReadLeaseCommand): boolean
{
	return [value.siloId, value.artifactId, value.artifactRevisionId].every(function _IsIdentifier(part): boolean
	{
		return /^[A-Za-z0-9_-]{1,128}$/u.test(part);
	});
}

/** Prove the repository returned the requested immutable coordinates and safe exact byte facts. */
function _MatchesCommand(target: PublishedArtifactReadTarget | null, command: IssueArtifactReadLeaseCommand): target is PublishedArtifactReadTarget
{
	return target !== null
		&& target.siloId === command.siloId
		&& target.artifactId === command.artifactId
		&& target.artifactRevisionId === command.artifactRevisionId
		&& /^sha256:[a-f0-9]{64}$/u.test(target.contentAddress)
		&& Number.isSafeInteger(target.byteLength)
		&& target.byteLength >= 0
		&& __IsSafeArtifactMediaType(target.mediaType);
}
