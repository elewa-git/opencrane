import { ElicitationRequestStates } from "@opencrane/contracts";

import { ElicitationLifecycleActions, ElicitationLifecycleEvents, type ElicitationLifecycleInput } from "./elicitation-lifecycle.types.js";

/** Exhaustive event decisions for every persisted request state. */
const _LIFECYCLE: Readonly<Record<ElicitationRequestStates, Readonly<Record<ElicitationLifecycleEvents, ElicitationLifecycleActions>>>> = {
	[ElicitationRequestStates.Requested]: {
		[ElicitationLifecycleEvents.Answer]: ElicitationLifecycleActions.Transition,
		[ElicitationLifecycleEvents.Decline]: ElicitationLifecycleActions.Transition,
		[ElicitationLifecycleEvents.Expire]: ElicitationLifecycleActions.Transition,
		[ElicitationLifecycleEvents.Cancel]: ElicitationLifecycleActions.Transition,
		[ElicitationLifecycleEvents.Fail]: ElicitationLifecycleActions.Transition,
	},
	[ElicitationRequestStates.Answered]: _Terminal(),
	[ElicitationRequestStates.Declined]: _Terminal(),
	[ElicitationRequestStates.Expired]: _Terminal(),
	[ElicitationRequestStates.Cancelled]: _Terminal(),
	[ElicitationRequestStates.Failed]: _Terminal(),
};

/** Decide one request transition without persistence or purpose-specific effects. */
export function __PlanElicitationLifecycle(input: ElicitationLifecycleInput): ElicitationLifecycleActions
{
	return _LIFECYCLE[input.state][input.event];
}

/** Reused immutable terminal-state event table. */
function _Terminal(): Readonly<Record<ElicitationLifecycleEvents, ElicitationLifecycleActions>>
{
	return {
		[ElicitationLifecycleEvents.Answer]: ElicitationLifecycleActions.AlreadyTerminal,
		[ElicitationLifecycleEvents.Decline]: ElicitationLifecycleActions.AlreadyTerminal,
		[ElicitationLifecycleEvents.Expire]: ElicitationLifecycleActions.AlreadyTerminal,
		[ElicitationLifecycleEvents.Cancel]: ElicitationLifecycleActions.AlreadyTerminal,
		[ElicitationLifecycleEvents.Fail]: ElicitationLifecycleActions.AlreadyTerminal,
	};
}
