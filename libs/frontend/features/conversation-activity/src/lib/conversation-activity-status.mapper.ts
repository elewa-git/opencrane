import { ScopeChipTones } from "@opencrane/elements/ui";
import type { ConversationActivityRunState } from "@opencrane/state/conversation/elicitation";

/** Keeps every current API state in one participant-facing label and semantic tone map. */
const _Statuses: Record<ConversationActivityRunState, { readonly label: string; readonly tone: ScopeChipTones }> = {
	accepted: { label: "Accepted", tone: ScopeChipTones.Neutral },
	queued: { label: "Queued", tone: ScopeChipTones.Neutral },
	assigned: { label: "Preparing", tone: ScopeChipTones.Info },
	running: { label: "Working", tone: ScopeChipTones.Info },
	waiting_for_input: { label: "Waiting for input", tone: ScopeChipTones.Warning },
	recovery_required: { label: "Needs attention", tone: ScopeChipTones.Warning },
	completed: { label: "Completed", tone: ScopeChipTones.Success },
	failed: { label: "Failed", tone: ScopeChipTones.Danger },
};

/** Maps a validated public state without exposing execution terminology or inventing success. */
export function _ConversationActivityRunStatus(state: ConversationActivityRunState) { return _Statuses[state]; }
