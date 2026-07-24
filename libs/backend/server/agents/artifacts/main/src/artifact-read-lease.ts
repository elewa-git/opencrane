import { randomUUID } from "node:crypto";

import type { ArtifactReadLeaseRepository, ArtifactReadLeaseSigner, IssueArtifactReadLeaseCommand, IssueArtifactReadLeaseResult, PublishedArtifactReadTarget } from "./artifact-read-lease.types.js";

/** Maximum lifetime for a service-verified internal artifact read lease. */
const _READ_LEASE_SECONDS = 300;

/** Issue one exact short-lived read lease from independently loaded active catalog facts. */
export async function __IssueArtifactReadLease(repository: ArtifactReadLeaseRepository, signer: ArtifactReadLeaseSigner, command: IssueArtifactReadLeaseCommand, nowEpochSeconds: number): Promise<IssueArtifactReadLeaseResult>
{
	if (!_IsCommand(command) || !Number.isSafeInteger(nowEpochSeconds) || nowEpochSeconds < 0)
	{
		return { outcome: "denied", reason: "invalid_command" };
	}

	// 1. Re-read the exact artifact revision under its silo; no caller metadata becomes lease content.
	const target = await repository.loadPublishedReadTarget(command);
	if (!_MatchesCommand(target, command))
	{
		return { outcome: "denied", reason: "revision_not_readable" };
	}

	// 2. Bind a new opaque lease to the immutable revision facts for one bounded service read.
	const claims = { leaseId: randomUUID(), siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId, contentAddress: target.contentAddress, action: "artifact.read" as const, expiresAtEpochSeconds: nowEpochSeconds + _READ_LEASE_SECONDS, byteLength: target.byteLength, mediaType: target.mediaType };

	// 3. Let only the composed signing authority turn reviewed catalog facts into a compact lease.
	return { outcome: "issued", compactLease: signer.sign(claims), claims };
}

/** Reject malformed coordinates before they can probe a catalog repository. */
function _IsCommand(value: IssueArtifactReadLeaseCommand): boolean
{
	return [value.siloId, value.artifactId, value.artifactRevisionId].every(function _isIdentifier(part): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(part); });
}

/** Prove the repository returned the requested immutable coordinates and safe exact byte facts. */
function _MatchesCommand(target: PublishedArtifactReadTarget | null, command: IssueArtifactReadLeaseCommand): target is PublishedArtifactReadTarget
{
	return target !== null && target.siloId === command.siloId && target.artifactId === command.artifactId && target.artifactRevisionId === command.artifactRevisionId && /^sha256:[a-f0-9]{64}$/.test(target.contentAddress) && Number.isSafeInteger(target.byteLength) && target.byteLength >= 0 && target.mediaType.includes("/");
}
