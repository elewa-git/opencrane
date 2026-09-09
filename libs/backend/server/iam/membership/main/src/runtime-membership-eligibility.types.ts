import type { ExecutionSubject } from "@opencrane/contracts";

/** Human membership evidence frozen into a run and rechecked before an outside effect. */
export interface RuntimeMembershipEligibilityCommand
{
	/** Silo in which the effect would run. */
	readonly siloId: string;
	/** Complete execution subject sealed when this run attempt was admitted. */
	readonly executionSubject: ExecutionSubject;
	/** Trusted server time used for membership freshness and expiry. */
	readonly nowEpochMs: number;
}

/** Rechecks deployment-selected human membership in an effect transaction.
 * Managed service and revision eligibility require their separate authority check. */
export interface RuntimeMembershipEligibility
{
	/** Returns true when current human membership still proves the frozen binding and lifetime. */
	isEligible(command: RuntimeMembershipEligibilityCommand): Promise<boolean>;
}
