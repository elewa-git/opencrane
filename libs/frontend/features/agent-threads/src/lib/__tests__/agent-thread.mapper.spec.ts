import { AvatarTones } from "@opencrane/elements/ui";
import { ConversationMessageTones, ConversationStatusTones } from "@opencrane/elements/conversation";
import { AgentThreadAccessStates, AgentThreadRunStates, AgentThreadSummaryStates, type AgentThreadRunBoundaryPresentation, type AgentThreadSummaryPresentation } from "@opencrane/state/conversation/agent-threads";

import { __AgentThreadMessagePresentation, __AgentThreadRunStatusPresentation, __AgentThreadSummaryStatusPresentation } from "../agent-thread.mapper.js";

/** Build one exact parent summary mapper input. */
function _Summary(state: AgentThreadSummaryStates): AgentThreadSummaryPresentation
{
	return { childConversationId: "child-1", state, access: AgentThreadAccessStates.Available, title: "Pricing", unreadCount: 0, participantInitials: [], replyCount: 0 };
}

/** Build one exact serial run mapper input. */
function _Run(state: AgentThreadRunStates): AgentThreadRunBoundaryPresentation
{
	return { runId: "run-1", ordinal: 1, state, label: "Run 1" };
}

describe("Agent-thread presentation mappers", function _AgentThreadMappers()
{
	it("keeps Agent and participant authorship visibly distinct", function _MessageAuthorship()
	{
		expect(__AgentThreadMessagePresentation({ id: "message-agent", authorName: "Nova", authorInitials: "N", authoredByAgent: true, timestampLabel: "11:08", body: "Working" })).toMatchObject({ avatarTone: AvatarTones.Brand, tone: ConversationMessageTones.Agent });
		expect(__AgentThreadMessagePresentation({ id: "message-user", authorName: "Alex", authorInitials: "AK", authoredByAgent: false, timestampLabel: "11:09", body: "Continue" })).toMatchObject({ avatarTone: AvatarTones.Blue, tone: ConversationMessageTones.Participant });
	});

	it("maps every run state without merging failure, cancellation, or retry", function _RunStates()
	{
		expect(Object.values(AgentThreadRunStates).map(state => __AgentThreadRunStatusPresentation(_Run(state)).tone)).toEqual([
			ConversationStatusTones.Attention,
			ConversationStatusTones.Neutral,
			ConversationStatusTones.Attention,
			ConversationStatusTones.Attention,
			ConversationStatusTones.Success,
			ConversationStatusTones.Danger,
			ConversationStatusTones.Danger
		]);
	});

	it("maps every compact summary state to stable plain-language copy", function _SummaryStates()
	{
		const presentations = Object.values(AgentThreadSummaryStates).map(state => __AgentThreadSummaryStatusPresentation(_Summary(state)));
		expect(presentations).toHaveLength(12);
		expect(presentations.map(presentation => presentation.label)).toContain("Completed after retry");
		expect(presentations.map(presentation => presentation.label)).toContain("Agent thread restricted");
	});
});
