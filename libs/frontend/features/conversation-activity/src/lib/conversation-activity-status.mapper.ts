import { ScopeChipTones } from "@opencrane/elements/ui";
import { ElicitationRequestStates, RunToolProgressPhases, type ConversationActivityRunState, type ConversationActivityRunToolProgress } from "@opencrane/state/conversation/elicitation";

/** Keeps every current API state in one participant-facing label and semantic tone map. */
const _Statuses: Record<ConversationActivityRunState, { readonly label: string; readonly tone: ScopeChipTones }> = {
	accepted: { label: "Accepted", tone: ScopeChipTones.Neutral },
	queued: { label: "Queued", tone: ScopeChipTones.Neutral },
	assigned: { label: "Preparing", tone: ScopeChipTones.Info },
	running: { label: "Working", tone: ScopeChipTones.Info },
	waiting_for_input: { label: "Waiting for input", tone: ScopeChipTones.Warning },
	cancelling: { label: "Stopping", tone: ScopeChipTones.Warning },
	cancelled: { label: "Stopped", tone: ScopeChipTones.Neutral },
	recovery_required: { label: "Needs attention", tone: ScopeChipTones.Warning },
	completed: { label: "Completed", tone: ScopeChipTones.Success },
	failed: { label: "Failed", tone: ScopeChipTones.Danger },
};

/** Maps a validated public state without exposing execution terminology or inventing success. */
export function _ConversationActivityRunStatus(state: ConversationActivityRunState) { return _Statuses[state]; }

/** Keeps request lifecycle wording participant-facing without changing server-owned state. */
const _ElicitationStatuses: Record<ElicitationRequestStates, { readonly label: string; readonly tone: ScopeChipTones }> = {
	[ElicitationRequestStates.Requested]: { label: "Needs response", tone: ScopeChipTones.Warning },
	[ElicitationRequestStates.Answered]: { label: "Answered", tone: ScopeChipTones.Success },
	[ElicitationRequestStates.Declined]: { label: "Declined", tone: ScopeChipTones.Neutral },
	[ElicitationRequestStates.Expired]: { label: "Expired", tone: ScopeChipTones.Neutral },
	[ElicitationRequestStates.Cancelled]: { label: "Cancelled", tone: ScopeChipTones.Neutral },
};

/** Maps a validated request state without exposing transport vocabulary. */
export function _ConversationActivityElicitationStatus(state: ElicitationRequestStates): { readonly label: string; readonly tone: ScopeChipTones } { return _ElicitationStatuses[state]; }

/** Maps a public tool phase to a participant-facing chip without implying that an answer exists. */
const _ToolPhases: Record<NonNullable<ConversationActivityRunToolProgress>["phase"], { readonly label: string; readonly tone: ScopeChipTones }> = {
	[RunToolProgressPhases.Queued]: { label: "Tool queued", tone: ScopeChipTones.Neutral },
	[RunToolProgressPhases.Running]: { label: "Tool running", tone: ScopeChipTones.Info },
	[RunToolProgressPhases.ResultReceived]: { label: "Tool result received", tone: ScopeChipTones.Info },
	[RunToolProgressPhases.NeedsAttention]: { label: "Tool needs attention", tone: ScopeChipTones.Warning },
};

/** Returns the tool phase chip without implying that an answer exists or an action is available. */
export function _ConversationActivityToolPhase(phase: NonNullable<ConversationActivityRunToolProgress>["phase"]): { readonly label: string; readonly tone: ScopeChipTones } { return _ToolPhases[phase]; }
