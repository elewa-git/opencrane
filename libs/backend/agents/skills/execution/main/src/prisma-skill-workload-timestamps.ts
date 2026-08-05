/**
 * Non-null epoch marker that asks a reviewed database trigger to assign the authoritative timestamp.
 *
 * This value is never interpreted as wall-clock time by application code.
 */
export const _SkillWorkloadTimestampProposal = new Date(0);

/** Encodes only a requested lease interval for the database trigger to anchor to its own clock. */
export function _SkillWorkloadLeaseExpiryProposal(leaseMilliseconds: number): Date
{
	return new Date(_SkillWorkloadTimestampProposal.getTime() + leaseMilliseconds);
}
