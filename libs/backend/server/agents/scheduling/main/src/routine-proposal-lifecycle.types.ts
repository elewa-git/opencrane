import type { RoutineProposalStates } from "@opencrane/contracts";

/** Events interpreted by the durable proposal state owner. */
export enum RoutineProposalLifecycleEvent
{
	Read = "read",
	Cancel = "cancel",
	Accept = "accept",
}

/** Exhaustive state decision returned before a compare-and-set. */
export interface RoutineProposalLifecycleDecision
{
	readonly nextState: RoutineProposalStates;
	readonly transition: boolean;
	readonly availableForAcceptance: boolean;
}
