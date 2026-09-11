import { describe, expect, it } from "vitest";

import { ScopeChipTones } from "@opencrane/elements/ui";
import { RunToolProgressPhases } from "@opencrane/state/conversation/elicitation";

import { _ConversationActivityRunStatus, _ConversationActivityToolPhase } from "../conversation-activity-status.mapper";

/** Pairs every public tool phase with its participant-facing presentation. */
const _PHASES: readonly (readonly [RunToolProgressPhases, string, ScopeChipTones])[] = [
	[RunToolProgressPhases.Queued, "Tool queued", ScopeChipTones.Neutral],
	[RunToolProgressPhases.Running, "Tool running", ScopeChipTones.Info],
	[RunToolProgressPhases.ResultReceived, "Tool result received", ScopeChipTones.Info],
	[RunToolProgressPhases.NeedsAttention, "Tool needs attention", ScopeChipTones.Warning],
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
});
