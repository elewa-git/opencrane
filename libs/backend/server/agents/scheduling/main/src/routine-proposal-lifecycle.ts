import { RoutineProposalStates } from "@opencrane/contracts";

import type { RoutineProposalLifecycleDecision } from "./routine-proposal-lifecycle.types";
import { RoutineProposalLifecycleEvent } from "./routine-proposal-lifecycle.types";

type _StateHandler = (event: RoutineProposalLifecycleEvent, expired: boolean) => RoutineProposalLifecycleDecision;

/** Exhaustive State x Event owner for proposal read, close and acceptance. */
const _HANDLERS: Record<RoutineProposalStates, _StateHandler> = {
	[RoutineProposalStates.Pending]: function _Pending(event, expired)
	{
		if (expired)
			return { nextState: RoutineProposalStates.Expired, transition: true, availableForAcceptance: false };
		if (event === RoutineProposalLifecycleEvent.Cancel)
			return { nextState: RoutineProposalStates.Cancelled, transition: true, availableForAcceptance: false };
		if (event === RoutineProposalLifecycleEvent.Accept)
			return { nextState: RoutineProposalStates.Accepted, transition: true, availableForAcceptance: true };
		return { nextState: RoutineProposalStates.Pending, transition: false, availableForAcceptance: true };
	},
	[RoutineProposalStates.Accepted]: function _Accepted()
	{
		return { nextState: RoutineProposalStates.Accepted, transition: false, availableForAcceptance: false };
	},
	[RoutineProposalStates.Cancelled]: function _Cancelled()
	{
		return { nextState: RoutineProposalStates.Cancelled, transition: false, availableForAcceptance: false };
	},
	[RoutineProposalStates.Expired]: function _Expired()
	{
		return { nextState: RoutineProposalStates.Expired, transition: false, availableForAcceptance: false };
	},
};

/** Applies lifecycle state and database-clock expiry without granting requester access. */
export function __DecideRoutineProposalLifecycle(state: RoutineProposalStates, event: RoutineProposalLifecycleEvent, expired: boolean): RoutineProposalLifecycleDecision
{
	return _HANDLERS[state](event, expired);
}
