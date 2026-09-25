import { describe, expect, it } from "vitest";

import { ScopeChipTones } from "@opencrane/elements/ui";
import { ElicitationRequestStates, RunToolProgressPhases } from "@opencrane/state/conversation/elicitation";

import { _ConversationActivityElicitationStatus, _ConversationActivityRunStatus, _ConversationActivityToolPhase } from "../conversation-activity-status.mapper";

/** Pairs every public tool phase with its participant-facing presentation. */
const _PHASES: readonly (readonly [RunToolProgressPhases, string, ScopeChipTones])[] = [
	[RunToolProgressPhases.Queued, "Tool queued", ScopeChipTones.Neutral],
	[RunToolProgressPhases.Running, "Tool running", ScopeChipTones.Info],
	[RunToolProgressPhases.ResultReceived, "Tool result received", ScopeChipTones.Info],
	[RunToolProgressPhases.NeedsAttention, "Tool needs attention", ScopeChipTones.Warning],
];

/** Pairs every request lifecycle with its participant-facing presentation. */
const _REQUEST_STATES: readonly (readonly [ElicitationRequestStates, string, ScopeChipTones])[] = [
	[ElicitationRequestStates.Requested, "Needs response", ScopeChipTones.Warning],
	[ElicitationRequestStates.Answered, "Answered", ScopeChipTones.Success],
	[ElicitationRequestStates.Declined, "Declined", ScopeChipTones.Neutral],
	[ElicitationRequestStates.Expired, "Expired", ScopeChipTones.Neutral],
	[ElicitationRequestStates.Cancelled, "Cancelled", ScopeChipTones.Neutral],
];

/** Verifies the participant-facing label and semantic tone for every public tool phase. */
describe("conversation activity tool phase presentation", function _Suite()
{
	it("renders Stop settlement without claiming terminal cancellation", function _StopStates()
	{
		expect(_ConversationActivityRunStatus("cancelling")).toEqual({ label: "Stopping", tone: ScopeChipTones.Warning });
		expect(_ConversationActivityRunStatus("cancelled")).toEqual({ label: "Stopped", tone: ScopeChipTones.Neutral });
	});

	it.each(_PHASES)("maps %s without changing the overall run state", function _Phase(phase: RunToolProgressPhases, label: string, tone: ScopeChipTones)
	{
		expect(_ConversationActivityToolPhase(phase)).toEqual({ label, tone });
	});

	it.each(_REQUEST_STATES)("maps request state %s without exposing protocol copy", function _RequestState(state: ElicitationRequestStates, label: string, tone: ScopeChipTones)
	{
		expect(_ConversationActivityElicitationStatus(state)).toEqual({ label, tone });
	});
});
