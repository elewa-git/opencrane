import { AgentThreadAccessStates, AgentThreadRecoveryStates, AgentThreadRunStates, AgentThreadSummaryStates, AgentThreadSummaryTargetKinds, AgentThreadTimelineEntryKinds, type AgentThreadSnapshot } from "@opencrane/state/conversation/agent-threads";

/**
 * Builds the initial child Agent-session projection used by the thread route.
 *
 * The local gateway stores this result so a follow-up or read marker remains visible on the next
 * route read.
 */
export function __CreateLocalAgentThread(parentConversationId: string, childConversationId: string): AgentThreadSnapshot
{
	return {
		parentConversationId,
		childConversationId,
		origin: {
			parentTitle: "Delivery planning",
			parentMessageId: "message-agent-1",
			invokedByName: "You",
			invokedByInitials: "Y",
			ask: "@agent compare the two delivery options",
			timestampLabel: "09:00"
		},
		summary: {
			childConversationId,
			state: AgentThreadSummaryStates.Working,
			access: AgentThreadAccessStates.Available,
			title: "Compare delivery options",
			preview: "Reviewing speed, risk, and dependencies",
			unreadCount: 1,
			participants: [
				{
					label: "You",
					initials: "Y"
				},
				{
					label: "The Commander (Guardian)",
					initials: "TC"
				}
			],
			replyCount: 1,
			runCount: 1,
			updateCount: 2,
			lastUpdateLabel: "09:01",
			assetCount: 0,
			target: {
				kind: AgentThreadSummaryTargetKinds.Thread,
				id: "thread-origin-local"
			}
		},
		recovery: AgentThreadRecoveryStates.Live,
		timeline: [
			{
				kind: AgentThreadTimelineEntryKinds.RunBoundary,
				id: "thread-run-boundary-local",
				run: {
					runId: "thread-run-local-1",
					ordinal: 1,
					state: AgentThreadRunStates.Working,
					label: "Run 1"
				}
			},
			{
				kind: AgentThreadTimelineEntryKinds.Message,
				id: "thread-message-local-1",
				message: {
					id: "thread-message-local-1",
					authorName: "The Commander (Guardian)",
					authorInitials: "TC",
					authoredByAgent: true,
					timestampLabel: "09:01",
					body: "I’m comparing speed, risk, and dependencies before recommending an option."
				}
			}
		],
		cursor: "thread-cursor-local-2",
		latestPosition: "2",
		representedThroughPosition: "2",
		visibleThroughPosition: "2",
		canSendFollowUp: true
	};
}

/** Combines both route identifiers because a child Agent session is addressed under its parent. */
export function __LocalAgentThreadKey(parentConversationId: string, childConversationId: string): string
{
	return `${parentConversationId}:${childConversationId}`;
}
