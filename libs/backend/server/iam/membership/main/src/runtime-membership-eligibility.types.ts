import type { RunInputSnapshotIdentity } from "@opencrane/contracts";

/** Signed membership identity frozen into a run and rechecked before an outside effect. */
export interface RuntimeMembershipEligibilityCommand
{
	/** Silo in which the effect would run. */
	readonly siloId: string;
	/** Full signed membership coordinates stored by run admission. */
	readonly identity: RunInputSnapshotIdentity;
	/** Trusted server time used for signature freshness and expiry. */
	readonly nowEpochMs: number;
}

/** Rechecks signed fleet membership on the transaction that admits an outside effect. */
export interface RuntimeMembershipEligibility
{
	/** Returns true only when the current signed revision still proves the frozen subject and evidence. */
	isEligible(command: RuntimeMembershipEligibilityCommand): Promise<boolean>;
}
