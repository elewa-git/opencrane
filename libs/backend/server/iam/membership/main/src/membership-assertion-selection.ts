import type { FleetMembershipAuthorityRepository, SelectFleetMembershipAssertionCommand, SelectFleetMembershipAssertionResult } from "./membership-authority.types";

/**
 * Selects one exact assertion from the newest revision owned by the trusted issuer.
 *
 * Callers use this before signature verification so request data can never choose its own proof.
 * Zero or several matches fail closed because either case leaves the subject's authority ambiguous.
 *
 * Called by: personal and managed execution-evidence authorities and the standalone membership verifier.
 */
export async function __SelectCurrentFleetMembershipAssertion(repository: FleetMembershipAuthorityRepository, command: SelectFleetMembershipAssertionCommand): Promise<SelectFleetMembershipAssertionResult>
{
	const revision = await repository.getLatestSignedRevision(command.trustedIssuerId, command.siloId);
	if (revision === null)
		return { outcome: "denied", reason: "missing_revision", revision: 0 };
	const assertions = revision.assertions.filter(function _MatchesSubject(assertion): boolean
	{
		return assertion.siloId === command.siloId && assertion.subjectId === command.subjectId;
	});
	if (assertions.length !== 1)
		return { outcome: "denied", reason: "assertion_mismatch", revision: revision.revision };
	return { outcome: "selected", assertionId: assertions[0]!.assertionId };
}
