import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";
import { ConversationLifecycles, ConversationModes, MessageContentBlockKinds, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
import type { ConversationWorkspaceDetail } from "@opencrane/state/conversation/workspace";

/**
 * Builds the Agent and group conversations shown when the workspace first loads.
 *
 * Both modes are present so the local stream proves that Agent runs never appear in group chat.
 */
export function __CreateLocalConversations(): readonly ConversationWorkspaceDetail[]
{
	return [
		{
			id: "conversation-agent",
			mode: ConversationModes.AgentSession,
			lifecycle: ConversationLifecycles.Open,
			agentServiceId: "agent-service-local-1",
			participantRefs: ["participant-self"],
			archivedAt: null,
			readThroughPosition: "2",
			updatedAt: "2026-08-21T09:05:00.000Z",
			visibleFromPosition: "1",
			accessEndedPosition: null,
			messages: [
				{
					id: "message-agent-1",
					position: "1",
					role: MessageRoles.User,
					state: MessageStates.Completed,
					source: MessageSources.UserInput,
					blocks: [
						{
							id: "block-agent-1",
							kind: MessageContentBlockKinds.Text,
							value: "Help me turn this week into a focused plan."
						}
					],
					runId: "run-local-1",
					participantRef: "participant-self",
					createdAt: "2026-08-21T09:00:00.000Z",
					completedAt: "2026-08-21T09:00:00.000Z",
					agentThread: null
				},
				{
					id: "message-agent-2",
					position: "2",
					role: MessageRoles.Assistant,
					state: MessageStates.Completed,
					source: MessageSources.ModelOutput,
					blocks: [
						{
							id: "block-agent-2",
							kind: MessageContentBlockKinds.Text,
							value: "Start with the two outcomes that unblock other work. I’ll keep dependencies and decisions visible as we go."
						}
					],
					runId: "run-local-1",
					participantRef: null,
					createdAt: "2026-08-21T09:00:02.000Z",
					completedAt: "2026-08-21T09:00:02.000Z",
					agentThread: null
				}
			]
		},
		{
			id: "conversation-group",
			mode: ConversationModes.Group,
			lifecycle: ConversationLifecycles.Open,
			agentServiceId: null,
			participantRefs: ["participant-self", "participant-one", "participant-two"],
			archivedAt: null,
			readThroughPosition: "1",
			updatedAt: "2026-08-21T08:00:00.000Z",
			visibleFromPosition: "1",
			accessEndedPosition: null,
			messages: [
				{
					id: "message-group-1",
					position: "1",
					role: MessageRoles.User,
					state: MessageStates.Completed,
					source: MessageSources.UserInput,
					blocks: [
						{
							id: "block-group-1",
							kind: MessageContentBlockKinds.Text,
							value: "The delivery plan is ready for review."
						}
					],
					runId: null,
					participantRef: "participant-one",
					createdAt: "2026-08-21T08:00:00.000Z",
					completedAt: "2026-08-21T08:00:00.000Z",
					agentThread: null
				}
			]
		}
	];
}

/** Builds the pending tool approval used by the elicitation and Activity flows. */
export function __CreateLocalElicitation(): ConversationElicitation
{
	return {
		version: CONVERSATION_ELICITATION_VERSION,
		requestId: "approval-local-1",
		conversationId: "conversation-agent",
		runId: "run-local-1",
		attempt: 1,
		assignedParticipantId: "participant-self",
		purpose: ElicitationPurposes.ToolApproval,
		state: ElicitationRequestStates.Requested,
		body: {
			kind: ElicitationBodyKinds.Approval,
			prompt: "Approve publishing the reviewed delivery draft?",
			action: "Publish the reviewed draft",
			target: "Delivery planning workspace",
			dataUse: "The draft and its cited project context",
			consequence: "The reviewed draft becomes visible to workspace participants.",
			cost: "$0"
		},
		requiresStepUp: false,
		requestedAt: "2026-08-21T09:02:00.000Z",
		expiresAt: "2026-08-21T11:02:00.000Z"
	};
}
