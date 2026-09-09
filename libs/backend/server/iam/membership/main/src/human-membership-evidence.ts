import { ExecutionSubjectMembershipKinds, type ExecutionSubjectHumanMembershipEvidence, type ExecutionSubjectMembershipEvidence } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

/** Binds recorded arguments and capability evidence to the complete verified human witness. */
export function __DigestHumanMembershipEvidence(evidence: ExecutionSubjectHumanMembershipEvidence): string
{
	return ___DigestCanonicalJson(evidence as unknown as JsonValue);
}

/** Supplies the audit revision for Fleet alone; local membership has no signed revision. */
export function __HumanMembershipRevision(evidence: ExecutionSubjectHumanMembershipEvidence): number | undefined
{
	return evidence.kind === ExecutionSubjectMembershipKinds.Fleet ? evidence.revision : undefined;
}

/**
 * Checks whether refreshed evidence still represents the frozen membership authority.
 * Called by: run recovery, credential expiry and runtime membership rechecks.
 * Standalone requires the same row version and external identity; observation times may advance.
 * Fleet and Managed retain their current revalidation rules in their respective authorities.
 * Deadlines are checked separately so this comparison can never extend a run's original expiry.
 */
export function __SameMembershipBinding(stored: ExecutionSubjectMembershipEvidence, current: ExecutionSubjectMembershipEvidence): boolean
{
	if (stored.kind !== current.kind || stored.principalId !== current.principalId || stored.siloId !== current.siloId)
		return false;
	if (stored.kind === ExecutionSubjectMembershipKinds.Fleet)
		return current.kind === ExecutionSubjectMembershipKinds.Fleet;
	if (stored.kind === ExecutionSubjectMembershipKinds.Managed)
		return current.kind === ExecutionSubjectMembershipKinds.Managed;
	if (stored.kind !== ExecutionSubjectMembershipKinds.Standalone || current.kind !== ExecutionSubjectMembershipKinds.Standalone)
		return false;
	return stored.issuer === current.issuer && stored.subjectId === current.subjectId
		&& stored.membershipId === current.membershipId && stored.membershipUpdatedAt === current.membershipUpdatedAt;
}
