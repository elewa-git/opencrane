import type { ConversationRunActionsPresentation } from "@opencrane/elements/conversation";
import { ConversationPersonalRunStates, type ConversationPersonalRun } from "@opencrane/state/conversation/workspace";

/**
 * Map authoritative personal work plus local Stop command state into the reusable action row.
 *
 * Called by: `ConversationWorkspacePresenter.runActions` for the selected personal conversation.
 *
 * @param run - Newest caller-owned run returned for the selected conversation.
 * @param stopPending - Whether the browser is waiting for authoritative Stop reconciliation.
 * @param busy - Whether the Stop control message is currently being submitted.
 * @param error - Fixed display-safe Stop failure retained for retry.
 * @returns A presentation for one current run, or null when no eligible personal run exists.
 */
export function _ConversationRunActions(run: ConversationPersonalRun | null, stopPending: boolean, busy: boolean, error: string | null): ConversationRunActionsPresentation | null
{
	if (run === null)
		return null;
	if (stopPending && error === null && _Stoppable(run.state))
		return { statusLabel: "Stop requested", detail: "Waiting for OpenCrane to confirm the current work state.", canStop: busy, busy, error: null };
	const state = _RunState(run.state);
	return { ...state, canStop: _Stoppable(run.state), busy, error };
}

/** Keeps every public lifecycle state in one exhaustive participant-facing presentation map. */
const _RunStates: Record<ConversationPersonalRun["state"], Pick<ConversationRunActionsPresentation, "statusLabel" | "detail">> = {
	[ConversationPersonalRunStates.Accepted]: { statusLabel: "Work accepted", detail: "The assistant is preparing to start." },
	[ConversationPersonalRunStates.Queued]: { statusLabel: "Work queued", detail: "The assistant will start when capacity is available." },
	[ConversationPersonalRunStates.Assigned]: { statusLabel: "Work starting", detail: "The assistant is preparing the requested work." },
	[ConversationPersonalRunStates.Running]: { statusLabel: "Assistant working", detail: "You can stop further work while this request is active." },
	[ConversationPersonalRunStates.WaitingForInput]: { statusLabel: "Waiting for your response", detail: "You can answer the request or stop the current work." },
	[ConversationPersonalRunStates.Cancelling]: { statusLabel: "Stopping work", detail: "No new work will start. Already dispatched effects may still need reconciliation." },
	[ConversationPersonalRunStates.Cancelled]: { statusLabel: "Work stopped", detail: "OpenCrane recorded this work as cancelled." },
	[ConversationPersonalRunStates.RecoveryRequired]: { statusLabel: "Work needs attention", detail: "OpenCrane could not safely determine every external effect." },
	[ConversationPersonalRunStates.Completed]: { statusLabel: "Work completed", detail: "The assistant finished this request." },
	[ConversationPersonalRunStates.Failed]: { statusLabel: "Work failed", detail: "The assistant could not finish this request." },
};

/** Translate one validated public run state into plain participant-facing copy. */
function _RunState(state: ConversationPersonalRun["state"]): Pick<ConversationRunActionsPresentation, "statusLabel" | "detail"> { return _RunStates[state]; }

/** Identify lifecycle states that still admit an explicit Stop request. */
function _Stoppable(state: ConversationPersonalRun["state"]): boolean
{
	switch (state)
	{
		case ConversationPersonalRunStates.Accepted:
		case ConversationPersonalRunStates.Running:
		case ConversationPersonalRunStates.WaitingForInput:
		case ConversationPersonalRunStates.RecoveryRequired: return true;
		default: return false;
	}
}
