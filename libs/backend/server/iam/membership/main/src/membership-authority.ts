import { __EvaluateFleetMembershipRevision } from "@opencrane/models/authorization";

import type { FleetMembershipAuthorityRepository, FleetMembershipSignatureVerifier, VerifyFleetMembershipCommand, VerifyFleetMembershipResult } from "./membership-authority.types.js";

/**
 * Verifies and monotonically accepts the latest signed fleet-membership revision.
 * A cached revision is trusted only until the earlier signed expiry or configured staleness limit.
 * @param repository - Signed-revision and accepted-high-watermark authority.
 * @param verifier - Cryptographic verifier for fleet envelopes.
 * @param command - Exact silo, subject, scope, and freshness expectation.
 * @returns Trusted membership window or a fail-closed denial.
 */
export async function __VerifyCurrentFleetMembership(repository: FleetMembershipAuthorityRepository, verifier: FleetMembershipSignatureVerifier, command: VerifyFleetMembershipCommand): Promise<VerifyFleetMembershipResult>
{
	// 1. Resolve only the freshest locally available signed revision; absence cannot imply membership.
	const revision = await repository.getLatestSignedRevision(command.trustedIssuerId, command.siloId);
	if (revision === null)
	{
		return { outcome: "denied", reason: "missing_revision", revision: 0 };
	}

	// 2. Obtain explicit cryptographic evidence; verifier failures never fall back to cached trust.
	let evidence;
	try
	{
		evidence = await verifier.verify(revision);
	}
	catch
	{
		return { outcome: "denied", reason: "signature_verifier_failed", revision: revision.revision };
	}

	// 3. Evaluate issuer, revision ordering, signature binding, assertion scope, expiry, and staleness.
	const highestAcceptedRevision = await repository.getHighestAcceptedRevision(command.trustedIssuerId, command.siloId);
	const decision = __EvaluateFleetMembershipRevision(revision, evidence, {
		trustedIssuerId: command.trustedIssuerId,
		siloId: command.siloId,
		subjectId: command.subjectId,
		assertionId: command.assertionId,
		scope: command.scope,
		nowEpochMs: command.nowEpochMs,
		lastAcceptedRevision: highestAcceptedRevision,
		maximumStalenessMs: command.maximumStalenessMs,
	});
	if (decision.outcome !== "trusted" || decision.trustedUntilEpochMs === undefined)
	{
		return { outcome: "denied", reason: decision.reason, revision: decision.revision };
	}

	// 4. Advance the high-watermark atomically so a newer concurrent acceptance defeats rollback.
	const acceptance = await repository.acceptRevisionAtomically({ issuerId: revision.issuerId, siloId: revision.siloId, revision: revision.revision, payloadDigest: revision.payloadDigest });
	if (acceptance.status === "conflict")
	{
		return { outcome: "denied", reason: "acceptance_conflict", revision: revision.revision };
	}

	return { outcome: "trusted", revision: revision.revision, trustedUntilEpochMs: decision.trustedUntilEpochMs };
}
