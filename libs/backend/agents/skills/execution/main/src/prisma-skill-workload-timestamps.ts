/**
 * A placeholder date — the Unix epoch — that tells the `skill_workloads_authority` trigger to fill in
 * the real timestamp from the database clock.
 *
 * Application code never reads this value as a real time.
 */
export const _SkillWorkloadTimestampProposal = new Date(0);

/** Returns the placeholder date plus the lease length. The trigger keeps only the gap between the two dates and re-anchors both to database time. */
export function _SkillWorkloadLeaseExpiryProposal(leaseMilliseconds: number): Date
{
	return new Date(_SkillWorkloadTimestampProposal.getTime() + leaseMilliseconds);
}
