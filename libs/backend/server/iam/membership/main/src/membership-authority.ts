import { __EvaluateFleetMembershipRevision } from "@opencrane/models/authorization";

import { FleetMembershipAcceptanceStatuses, FleetMembershipEvidenceOutcomes, type FleetMembershipAuthorityRepository, type FleetMembershipSignatureVerifier, type VerifyFleetMembershipCommand, type VerifyFleetMembershipEvidenceResult } from "./membership-authority.types";

/**
 * Checks one subject's fleet membership and returns the signed facts to record on the run.
 *
 * Four steps, in this order: load the newest stored revision for the trusted issuer; check the
 * issuer's signature; apply the ordering, identity, expiry, and staleness rules; and only then record
 * that revision as the newest one this silo accepts. Doing that last step before returning is what
 * makes a replay of an older signed revision fail — two concurrent admissions race on that number
 * and the loser gets `acceptance_conflict` instead of trust. Every field of the returned evidence
 * comes from the signed revision, never from the caller's input, so a run's stored membership can
 * be checked against the issuer's signature later.
 *
 * Called by `PrismaPersonalExecutionEvidenceRepository`, which passes the transaction of the run
 * admission it is already inside.
 * @param repository - Store of signed revisions and of the newest accepted revision per silo.
 * @param verifier - Holder of the issuer's public key.
 * @param command - Silo, subject, assertion, current time, and staleness limit.
 * @returns `trusted` with signed evidence, or `denied` with a reason: `missing_revision`,
 *          `signature_verifier_failed`, `acceptance_conflict`, or a rule from the trust evaluation.
 */
export async function __VerifyCurrentFleetMembershipEvidence(repository: FleetMembershipAuthorityRepository, verifier: FleetMembershipSignatureVerifier, command: VerifyFleetMembershipCommand): Promise<VerifyFleetMembershipEvidenceResult>
{
	// 1. Load the newest stored revision; if none exists, the subject is not a member.
	const revision = await repository.getLatestSignedRevision(command.trustedIssuerId, command.siloId);
	if (revision === null)
	{
		return { outcome: "denied", reason: "missing_revision", revision: 0 };
	}

	// 2. Check the signature; if the verifier throws, deny instead of reusing an earlier result.
	let evidence;
	try
	{
		evidence = await verifier.verify(revision);
	}
	catch
	{
		return { outcome: "denied", reason: "signature_verifier_failed", revision: revision.revision };
	}

	// 3. Evaluate issuer, revision ordering, signature binding, asserted identity, expiry, and staleness.
	const highestAcceptedRevision = await repository.getHighestAcceptedRevision(command.trustedIssuerId, command.siloId);
	const decision = __EvaluateFleetMembershipRevision(revision, evidence, {
		trustedIssuerId: command.trustedIssuerId,
		siloId: command.siloId,
		subjectId: command.subjectId,
		assertionId: command.assertionId,
		nowEpochMs: command.nowEpochMs,
		lastAcceptedRevision: highestAcceptedRevision,
		maximumStalenessMs: command.maximumStalenessMs,
	});
	if (decision.outcome !== FleetMembershipEvidenceOutcomes.Trusted)
	{
		return { outcome: "denied", reason: decision.reason, revision: decision.revision };
	}

	// 4. Record this revision as the newest accepted one. If another admission already recorded a
	//    newer one, this check loses and denies rather than trusting an older revision.
	const acceptance = await repository.acceptRevisionAtomically({ issuerId: revision.issuerId, siloId: revision.siloId, revision: revision.revision, payloadDigest: revision.payloadDigest });
	if (acceptance.status === FleetMembershipAcceptanceStatuses.Conflict)
	{
		return { outcome: "denied", reason: "acceptance_conflict", revision: revision.revision };
	}

	return { outcome: "trusted", evidence: { issuerId: revision.issuerId, issuerKeyId: revision.issuerKeyId, revision: revision.revision, assertionId: command.assertionId, subjectId: command.subjectId, payloadDigest: revision.payloadDigest, trustedUntilEpochMs: decision.trustedUntilEpochMs } };
}
