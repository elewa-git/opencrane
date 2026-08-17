import { ConversationLifecycles, ConversationModes, ConversationPersonalAgentStatuses, MessageRoles, MessageSources, MessageStates, type ConversationMessage, type ConversationSummary } from "@opencrane/state/conversation/workspace";

import { _ConversationMessageView, _ConversationOnboardingContinuationPresentation, _ConversationSummaryPresentation } from "../conversation-workspace.mapper";

/** Build one direct-conversation summary without introducing display names. */
function _Summary(): ConversationSummary
{
	return { id: "conversation-1", mode: ConversationModes.Direct, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: ["subject-secret", "other-secret"], archivedAt: null, updatedAt: "2026-08-12T11:08:00.000Z" };
}

/** Build one participant message containing unsafe markup. */
function _Message(): ConversationMessage
{
	return { id: "message-1", position: "1", role: MessageRoles.User, state: MessageStates.Completed, source: MessageSources.UserInput, blocks: [{ id: "block-1", kind: "text", value: "Hello <script>alert('secret')</script>" }], runId: null, participantRef: "other-secret", createdAt: "2026-08-12T11:08:00.000Z", agentThread: null };
}

describe("Conversation workspace presentation", function _ConversationWorkspacePresentation()
{
	it("uses generic participant labels without exposing opaque references", function _GenericLabels()
	{
		const summary = _ConversationSummaryPresentation(_Summary(), null);
		expect(summary).toMatchObject({ title: "Direct conversation", participantLabel: "You and Participant 1" });
		expect(JSON.stringify(summary)).not.toContain("subject-secret");
		expect(JSON.stringify(summary)).not.toContain("other-secret");
	});

	it("sanitizes message markup and keeps authorship generic", function _SafeMessage()
	{
		const view = _ConversationMessageView(_Message(), { summary: _Summary(), directory: { participants: [{ participantRef: "subject-secret", isSelf: true, label: "You" }, { participantRef: "other-secret", isSelf: false, label: "Participant 1" }], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null } });
		expect(view.message.authorName).toBe("Participant 1");
		expect(view.richText.html).not.toContain("<script");
		expect(view.richText.html).toContain("Hello");
	});

	it("keeps history continuation truthful for every personal Agent status", function _HistoryContinuation()
	{
		const self = { participantRef: "subject-secret", isSelf: true, label: "You" } as const;
		const participants = [self, { participantRef: "other-secret", isSelf: false, label: "Participant 1" }] as const;
		const ready = _ConversationOnboardingContinuationPresentation({ participants: [self], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-secret", displayName: "Nova" } });
		const unavailable = _ConversationOnboardingContinuationPresentation({ participants, personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });
		const ambiguous = _ConversationOnboardingContinuationPresentation({ participants, personalAgentStatus: ConversationPersonalAgentStatuses.Ambiguous, personalAgent: null });
		const withoutDestination = _ConversationOnboardingContinuationPresentation({ participants: [self], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });
		const unknown = _ConversationOnboardingContinuationPresentation(null);
		const withoutMembership = _ConversationOnboardingContinuationPresentation({ participants: [], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null });

		expect(ready.detail).toContain("continue with your Agent");
		expect(unavailable.detail).toContain("Direct and group chats are available");
		expect(ambiguous.detail).toContain("repairs the personal Agent assignment");
		expect([ready, unavailable, ambiguous].every(presentation => presentation.canStartNewChat)).toBe(true);
		expect(withoutDestination.detail).toContain("No participant or personal Agent");
		expect([withoutDestination, unknown, withoutMembership].every(presentation => !presentation.canStartNewChat)).toBe(true);
	});
});
