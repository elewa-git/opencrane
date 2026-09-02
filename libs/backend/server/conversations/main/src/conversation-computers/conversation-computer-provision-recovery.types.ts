import type { ConversationComputer } from "@opencrane/contracts";

/** States whether KurrentDB acknowledged a cold provision or history recovered it after an ambiguous append. */
export enum _ConversationComputerProvisionRecoveryOutcomes
{
	/** KurrentDB acknowledged the append that established the cold computer stream. */
	Provisioned = "provisioned",
	/** History confirmed the same cold revision-zero stream after the append response was lost or rejected as a duplicate. */
	Recovered = "recovered",
}

/** Carries the event identifier and cold snapshot that the creation reservation froze before history I/O. */
export interface _ConversationComputerProvisionRecoveryCommand
{
	/** Supplies the UUID that the creation reservation assigned to this provision event. */
	readonly eventId: string;
	/** Supplies the server-resolved cold computer snapshot that history must match. */
	readonly computer: ConversationComputer;
}

/** Reports whether the cold computer provision append completed or history recovered its record. */
export interface _ConversationComputerProvisionRecoveryResult
{
	/** States whether KurrentDB acknowledged the append or history proved recovery. */
	readonly outcome: _ConversationComputerProvisionRecoveryOutcomes;
}
