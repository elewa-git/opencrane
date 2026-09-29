import { describe, expect, it } from "vitest";

import { RoutineProposalStates } from "@opencrane/contracts";

import { __DecideRoutineProposalLifecycle } from "../routine-proposal-lifecycle";
import { RoutineProposalLifecycleEvent } from "../routine-proposal-lifecycle.types";

describe("routine proposal lifecycle", function _Suite()
{
	it.each([
		[RoutineProposalStates.Pending, RoutineProposalLifecycleEvent.Read, false, RoutineProposalStates.Pending, false, true],
		[RoutineProposalStates.Pending, RoutineProposalLifecycleEvent.Cancel, false, RoutineProposalStates.Cancelled, true, false],
		[RoutineProposalStates.Pending, RoutineProposalLifecycleEvent.Accept, false, RoutineProposalStates.Accepted, true, true],
		[RoutineProposalStates.Pending, RoutineProposalLifecycleEvent.Read, true, RoutineProposalStates.Expired, true, false],
		[RoutineProposalStates.Pending, RoutineProposalLifecycleEvent.Cancel, true, RoutineProposalStates.Expired, true, false],
		[RoutineProposalStates.Pending, RoutineProposalLifecycleEvent.Accept, true, RoutineProposalStates.Expired, true, false],
		[RoutineProposalStates.Accepted, RoutineProposalLifecycleEvent.Read, false, RoutineProposalStates.Accepted, false, false],
		[RoutineProposalStates.Accepted, RoutineProposalLifecycleEvent.Cancel, false, RoutineProposalStates.Accepted, false, false],
		[RoutineProposalStates.Accepted, RoutineProposalLifecycleEvent.Accept, false, RoutineProposalStates.Accepted, false, false],
		[RoutineProposalStates.Cancelled, RoutineProposalLifecycleEvent.Read, false, RoutineProposalStates.Cancelled, false, false],
		[RoutineProposalStates.Cancelled, RoutineProposalLifecycleEvent.Cancel, false, RoutineProposalStates.Cancelled, false, false],
		[RoutineProposalStates.Cancelled, RoutineProposalLifecycleEvent.Accept, false, RoutineProposalStates.Cancelled, false, false],
		[RoutineProposalStates.Expired, RoutineProposalLifecycleEvent.Read, false, RoutineProposalStates.Expired, false, false],
		[RoutineProposalStates.Expired, RoutineProposalLifecycleEvent.Cancel, false, RoutineProposalStates.Expired, false, false],
		[RoutineProposalStates.Expired, RoutineProposalLifecycleEvent.Accept, false, RoutineProposalStates.Expired, false, false],
	] as const)("decides %s x %s with expiry %s", function _Decision(state, event, expired, nextState, transition, availableForAcceptance)
	{
		expect(__DecideRoutineProposalLifecycle(state, event, expired)).toEqual({ nextState, transition, availableForAcceptance });
	});
});
