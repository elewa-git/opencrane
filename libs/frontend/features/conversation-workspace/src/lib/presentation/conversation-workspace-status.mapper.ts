import { ConversationComputerStates } from "@opencrane/contracts";
import { ConversationComposerStates, ConversationStatusTones, type ConversationStatusPresentation } from "@opencrane/elements/conversation";
import { ConversationEventStreamStatuses, ConversationLifecycles } from "@opencrane/state/conversation/workspace";
import type { ConversationWorkspaceConnectionPresentation } from "./conversation-workspace-presentation.types";

/** Derive composer state without mixing run lifecycle into ordinary chats. */
export function _ComposerState(sending: boolean, streamStatus: ConversationEventStreamStatuses | null, lifecycle: ConversationLifecycles | undefined): ConversationComposerStates
{
	if (sending)
		return ConversationComposerStates.Submitting;
	if (streamStatus !== ConversationEventStreamStatuses.Live)
		return ConversationComposerStates.Disabled;
	return lifecycle === ConversationLifecycles.Open ? ConversationComposerStates.Available : ConversationComposerStates.Disabled;
}

/** Map stream connection and failure truth to the in-composer recovery bar. */
export function _ConnectionStatus(status: ConversationEventStreamStatuses | null, reconnectAttempt: number): ConversationWorkspaceConnectionPresentation | null
{
	if (status === ConversationEventStreamStatuses.Connecting)
		return { status: { label: "Connecting to chat", detail: "Messages will be available when the connection is ready.", tone: ConversationStatusTones.Neutral }, reconnectAvailable: false };
	if (status === ConversationEventStreamStatuses.Reconnecting)
		return { status: { label: `Reconnecting — attempt ${reconnectAttempt}`, detail: "Your draft is still here. Sending resumes when the connection returns.", tone: ConversationStatusTones.Attention }, reconnectAvailable: true };
	if (status === ConversationEventStreamStatuses.Failed)
		return { status: { label: "Connection lost", detail: "Automatic reconnecting stopped. Your draft is still here.", tone: ConversationStatusTones.Danger, assertive: true }, reconnectAvailable: true };
	return null;
}

/** Map the current logical computer lifecycle to concise participant-facing copy. */
export function _ComputerStatus(state: ConversationComputerStates | undefined): ConversationStatusPresentation | null
{
	if (state === undefined)
		return null;
	return { label: _ComputerLabel(state), detail: "Your conversation history remains available while the computer changes state.", tone: state === ConversationComputerStates.RecoveryRequired ? ConversationStatusTones.Danger : ConversationStatusTones.Neutral };
}

/** Plain participant-facing label for every logical computer lifecycle. */
function _ComputerLabel(state: ConversationComputerStates): string
{
	switch (state)
	{
		case ConversationComputerStates.Cold: return "Computer is asleep";
		case ConversationComputerStates.ClaimPending: return "Computer is waking";
		case ConversationComputerStates.Warm: return "Computer is ready";
		case ConversationComputerStates.Cooling: return "Computer is saving work";
		case ConversationComputerStates.RecoveryRequired: return "Computer needs attention";
		case ConversationComputerStates.Retired: return "Computer is retired";
	}
}
