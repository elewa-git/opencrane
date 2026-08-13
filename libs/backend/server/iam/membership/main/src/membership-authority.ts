import { __EvaluateFleetMembershipRevision } from "@opencrane/models/authorization";

import type { FleetMembershipAuthorityRepository, FleetMembershipSignatureVerifier, VerifyFleetMembershipCommand, VerifyFleetMembershipEvidenceResult, VerifyFleetMembershipResult } from "./membership-authority.types.js";

/**
 * Checks one subject's fleet membership and reports how long it may be trusted.
 *
 * A thin wrapper over {@link __VerifyCurrentFleetMembershipEvidence} for callers that only need
 * "yes, until when" and have no use for the signed facts. Trust ends at the earlier of the
 * revision's own expiry and the configured staleness limit, so a silo that stops receiving new
 * revisions loses membership by itself instead of coasting on an old one.
 *
 * Called by: SignedFleetMembershipAssertionVerifier in this package — the only caller today.
 * @param repository - Store of signed revisions and of the newest accepted revision per silo.
 * @param verifier - Holder of the issuer's public key.
 * @param command - Silo, subject, assertion, scope, current time, and staleness limit.
 * @returns `trusted` with the revision and the instant trust runs out, or `denied` with the reason
 *          the check failed; a denial never means "retry without checking".
 */
export async function __VerifyCurrentFleetMembership(repository: FleetMembershipAuthorityRepository, verifier: FleetMembershipSignatureVerifier, command: VerifyFleetMembershipCommand): Promise<VerifyFleetMembershipResult>
{
	const result = await __VerifyCurrentFleetMembershipEvidence(repository, verifier, command);
	if (result.outcome === "denied") return result;
	return { outcome: "trusted", revision: result.evidence.revision, trustedUntilEpochMs: result.evidence.trustedUntilEpochMs };
}

/**
 * Checks one subject's fleet membership and returns the signed facts to record on the run.
 *
 * Four steps, in this order: load the newest stored revision for the trusted issuer; check the
 * issuer's signature; apply the ordering, scope, expiry, and staleness rules; and only then record
 * that revision as the newest one this silo accepts. Doing that last step before returning is what
 * makes a replay of an older signed revision fail — two concurrent admissions race on that number
 * and the loser gets `acceptance_conflict` instead of trust. Every field of the returned evidence
 * comes from the signed revision, never from the caller's input, so a run's stored membership can
 * be checked against the issuer's signature later.
 *
 * Called by: libs/backend/agents/execution/inputs/main/src/personal-execution-identity-envelope-source.ts
 * and libs/backend/server/agents/agent-services/main/src/prisma-managed-execution-evidence.ts, both
 * passing the transaction of the run admission they are already inside.
 * @param repository - Store of signed revisions and of the newest accepted revision per silo.
 * @param verifier - Holder of the issuer's public key.
 * @param command - Silo, subject, assertion, scope, current time, and staleness limit.
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
	if (decision.outcome !== "trusted")
	{
		return { outcome: "denied", reason: decision.reason, revision: decision.revision };
	}

	// 4. Record this revision as the newest accepted one. If another admission already recorded a
	//    newer one, this check loses and denies rather than trusting an older revision.
	const acceptance = await repository.acceptRevisionAtomically({ issuerId: revision.issuerId, siloId: revision.siloId, revision: revision.revision, payloadDigest: revision.payloadDigest });
	if (acceptance.status === "conflict")
	{
		return { outcome: "denied", reason: "acceptance_conflict", revision: revision.revision };
	}

	return { outcome: "trusted", evidence: { issuerId: revision.issuerId, issuerKeyId: revision.issuerKeyId, revision: revision.revision, assertionId: command.assertionId, subjectId: command.subjectId, organizationId: decision.organizationId, payloadDigest: revision.payloadDigest, trustedUntilEpochMs: decision.trustedUntilEpochMs } };
}
