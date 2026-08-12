import { AvatarTones } from "@opencrane/elements/ui";
import { ConversationMessageTones, ConversationStatusTones, type ConversationMessagePresentation, type ConversationStatusPresentation } from "@opencrane/elements/conversation";
import { AgentThreadRunStates, AgentThreadSummaryStates, type AgentThreadMessagePresentation, type AgentThreadRunBoundaryPresentation, type AgentThreadSummaryPresentation } from "@opencrane/state/conversation/agent-threads";

/** Map a dependency-neutral child message into the shared conversation element contract. */
export function __AgentThreadMessagePresentation(message: AgentThreadMessagePresentation): ConversationMessagePresentation
{
	const avatarTone = message.authoredByAgent ? AvatarTones.Brand : AvatarTones.Blue;
	const tone = message.authoredByAgent ? ConversationMessageTones.Agent : ConversationMessageTones.Participant;
	return { id: message.id, authorName: message.authorName, authorInitials: message.authorInitials, avatarTone, timestampLabel: message.timestampLabel, body: message.body, tone };
}

/** Map one independent run state into a short shared status projection. */
export function __AgentThreadRunStatusPresentation(run: AgentThreadRunBoundaryPresentation): ConversationStatusPresentation
{
	let tone = ConversationStatusTones.Neutral;
	switch (run.state)
	{
		case AgentThreadRunStates.Waiting:
		case AgentThreadRunStates.Retrying:
		case AgentThreadRunStates.Queued:
			tone = ConversationStatusTones.Attention;
			break;
		case AgentThreadRunStates.Completed:
			tone = ConversationStatusTones.Success;
			break;
		case AgentThreadRunStates.Failed:
		case AgentThreadRunStates.Cancelled:
			tone = ConversationStatusTones.Danger;
			break;
		case AgentThreadRunStates.Working:
			tone = ConversationStatusTones.Neutral;
			break;
	}
	return { label: run.label, detail: run.detail, tone, assertive: run.state === AgentThreadRunStates.Failed };
}

/** Map one finite parent summary into a short status without merging access or recovery authority. */
export function __AgentThreadSummaryStatusPresentation(summary: AgentThreadSummaryPresentation): ConversationStatusPresentation
{
	let tone = ConversationStatusTones.Neutral;
	switch (summary.state)
	{
		case AgentThreadSummaryStates.Waiting:
		case AgentThreadSummaryStates.Retrying:
		case AgentThreadSummaryStates.Starting:
		case AgentThreadSummaryStates.Reconnecting:
			tone = ConversationStatusTones.Attention;
			break;
		case AgentThreadSummaryStates.Completed:
		case AgentThreadSummaryStates.CompletedAfterRetry:
			tone = ConversationStatusTones.Success;
			break;
		case AgentThreadSummaryStates.Failed:
		case AgentThreadSummaryStates.Cancelled:
		case AgentThreadSummaryStates.Restricted:
		case AgentThreadSummaryStates.CreationFailed:
			tone = ConversationStatusTones.Danger;
			break;
		case AgentThreadSummaryStates.Working:
		case AgentThreadSummaryStates.Closed:
			tone = ConversationStatusTones.Neutral;
			break;
	}
	return { label: _SummaryLabel(summary.state), detail: summary.preview, tone, assertive: summary.state === AgentThreadSummaryStates.Failed || summary.state === AgentThreadSummaryStates.CreationFailed };
}

/** Resolve one concise label for every parent-summary state. */
function _SummaryLabel(state: AgentThreadSummaryStates): string
{
	switch (state)
	{
		case AgentThreadSummaryStates.Starting: return "Starting Agent thread";
		case AgentThreadSummaryStates.Working: return "Agent working";
		case AgentThreadSummaryStates.Waiting: return "Waiting for your response";
		case AgentThreadSummaryStates.Retrying: return "Retrying after a failed attempt";
		case AgentThreadSummaryStates.Completed: return "Completed";
		case AgentThreadSummaryStates.CompletedAfterRetry: return "Completed after retry";
		case AgentThreadSummaryStates.Failed: return "Agent run failed";
		case AgentThreadSummaryStates.Cancelled: return "Agent run cancelled";
		case AgentThreadSummaryStates.Closed: return "Agent thread closed";
		case AgentThreadSummaryStates.Restricted: return "Agent thread restricted";
		case AgentThreadSummaryStates.CreationFailed: return "Agent thread was not created";
		case AgentThreadSummaryStates.Reconnecting: return "Reconnecting";
	}
}
