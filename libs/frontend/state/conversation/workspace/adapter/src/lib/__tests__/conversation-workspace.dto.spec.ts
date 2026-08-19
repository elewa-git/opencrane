import type { paths } from "@opencrane/contracts";
import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
import { PersonaFirstChatArchetypes, PersonaFirstChatColours, PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationRunStates } from "@opencrane/state/conversation/workspace";

import { _ConversationDetail, _ConversationRun, _ConversationSummary, _ConversationWorkspaceDirectory } from "../conversation-workspace.dto";

describe("conversation workspace DTO mapping", function _ConversationWorkspaceDto()
{
	it("uses generic participant labels without displaying opaque references", function _GenericLabels()
	{
		const directory = _ConversationWorkspaceDirectory({ participants: [{ participantRef: "secret-looking-ref", isSelf: false }, { participantRef: "self-ref", isSelf: true }], personalAgentStatus: "ready", personalAgent: { personalAgentRef: "agent-ref", displayName: "Nova" } });
		expect(directory).toEqual({ participants: [{ participantRef: "secret-looking-ref", isSelf: false, label: "Participant 1" }, { participantRef: "self-ref", isSelf: true, label: "You" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-ref", displayName: "Nova" } });
		expect(JSON.stringify(directory)).not.toContain("subject");
	});

	it("accepts the server's participant read position in conversation lists", function _ReadThroughPosition()
	{
		const summary = _ConversationSummary({ id: "conversation-1", mode: "direct", lifecycle: "open", agentServiceId: null, participantRefs: ["member-1", "member-2"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-08-12T09:00:00.000Z" } satisfies paths["/me/conversations"]["get"]["responses"][200]["content"]["application/json"]["conversations"][number]);
		expect(summary.readThroughPosition).toBe("0");
	});

	it("accepts server detail fields and sorts messages by timeline position", function _TimelineOrder()
	{
		const detail = _ConversationDetail({ id: "conversation-1", mode: "group", lifecycle: "open", agentServiceId: null, participantRefs: ["member-1"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-08-12T09:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [{ id: "later", position: "10", role: "user", state: "completed", source: "user_input", blocks: [{ id: "block-2", kind: "text", value: "Later" }], runId: null, participantRef: "member-1", createdAt: "2026-08-12T08:00:00.000Z", completedAt: "2026-08-12T08:00:01.000Z", agentThread: null }, { id: "earlier", position: "2", role: "assistant", state: "completed", source: "model_output", blocks: [{ id: "block-1", kind: "text", value: "Earlier" }], runId: "run-1", participantRef: null, createdAt: "2026-08-12T09:00:00.000Z", completedAt: "2026-08-12T09:00:01.000Z", agentThread: null }] } satisfies paths["/me/conversations"]["post"]["responses"][201]["content"]["application/json"]["conversation"]);
		expect(detail.mode).toBe(ConversationModes.Group);
		expect(detail.lifecycle).toBe(ConversationLifecycles.Open);
		expect(detail.readThroughPosition).toBe("0");
		expect(detail.messages.map(message => message.id)).toEqual(["earlier", "later"]);
		expect(detail.messages[0]?.completedAt).toBe("2026-08-12T09:00:01.000Z");
		expect(detail.messages[0]).toMatchObject({ role: MessageRoles.Assistant, state: MessageStates.Completed, source: MessageSources.ModelOutput });
	});

	it("rejects unknown categorical values instead of guessing", function _RejectsUnknown()
	{
		expect(function _InvalidDirectory() { _ConversationWorkspaceDirectory({ participants: [], personalAgentStatus: "mystery", personalAgent: null }); }).toThrow();
		expect(function _InvalidRun() { _ConversationRun({ runId: "run-1", attempt: 1, state: "mystery", conversationId: "conversation-1" }); }).toThrow();
		expect(_ConversationRun({ runId: "run-1", attempt: 1, state: "failed", conversationId: "conversation-1" }).state).toBe(ConversationRunStates.Failed);
	});

	it("rejects malformed nested message values at the model boundary", function _RejectsMalformedNestedMessage()
	{
		expect(function _InvalidNestedMessage()
		{
			_ConversationDetail({ id: "conversation-1", mode: "group", lifecycle: "open", agentServiceId: null, participantRefs: ["member-1"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-08-12T09:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [{ id: "message-1", position: "1", role: "user", state: "completed", source: "user_input", blocks: [{ id: "", kind: "text", value: "Invalid" }], runId: null, participantRef: "member-1", createdAt: "2026-08-12T09:00:00.000Z", completedAt: "2026-08-12T09:00:01.000Z", agentThread: null }] });
		}).toThrow();
	});

	it("rejects message completion times that contradict message state", function _MessageCompletionInvariant()
	{
		const detail = { id: "conversation-1", mode: "group", lifecycle: "open", agentServiceId: null, participantRefs: ["member-1"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-08-12T09:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [{ id: "message-1", position: "1", role: "assistant", state: "completed", source: "model_output", blocks: [{ id: "block-1", kind: "text", value: "Done" }], runId: "run-1", participantRef: null, createdAt: "2026-08-12T09:00:00.000Z", completedAt: "2026-08-12T09:00:01.000Z", agentThread: null }] } satisfies paths["/me/conversations"]["post"]["responses"][201]["content"]["application/json"]["conversation"];
		const message = detail.messages[0];
		expect(function _TerminalWithoutCompletion() { _ConversationDetail({ ...detail, messages: [{ ...message, completedAt: null }] }); }).toThrow();
		expect(function _NonTerminalWithCompletion() { _ConversationDetail({ ...detail, messages: [{ ...message, state: "streaming" }] }); }).toThrow();
	});
});
