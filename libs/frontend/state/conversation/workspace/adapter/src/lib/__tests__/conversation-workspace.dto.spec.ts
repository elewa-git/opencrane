import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
import { ConversationPersonalAgentStatuses, ConversationRunStates } from "@opencrane/state/conversation/workspace";

import { _ConversationDetail, _ConversationRun, _ConversationWorkspaceDirectory } from "../conversation-workspace.dto.js";

describe("conversation workspace DTO mapping", function _ConversationWorkspaceDto()
{
	it("uses generic participant labels without displaying opaque references", function _GenericLabels()
	{
		const directory = _ConversationWorkspaceDirectory({ participants: [{ participantRef: "secret-looking-ref", isSelf: false }, { participantRef: "self-ref", isSelf: true }], personalAgentStatus: "ready", personalAgent: { personalAgentRef: "agent-ref", displayName: "Nova" } });
		expect(directory).toEqual({ participants: [{ participantRef: "secret-looking-ref", isSelf: false, label: "Participant 1" }, { participantRef: "self-ref", isSelf: true, label: "You" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-ref", displayName: "Nova" } });
		expect(JSON.stringify(directory)).not.toContain("subject");
	});

	it("sorts canonical messages by decimal position rather than timestamp", function _TimelineOrder()
	{
		const detail = _ConversationDetail({ id: "conversation-1", mode: "group", lifecycle: "open", agentServiceId: null, participantRefs: ["member-1"], archivedAt: null, updatedAt: "2026-08-12T09:00:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [{ id: "later", position: "10", role: "user", state: "completed", source: "user_input", blocks: [{ id: "block-2", kind: "text", value: "Later" }], runId: null, participantRef: "member-1", createdAt: "2026-08-12T08:00:00.000Z", agentThread: null }, { id: "earlier", position: "2", role: "assistant", state: "completed", source: "model_output", blocks: [{ id: "block-1", kind: "text", value: "Earlier" }], runId: "run-1", participantRef: null, createdAt: "2026-08-12T09:00:00.000Z", agentThread: null }] });
		expect(detail.mode).toBe(ConversationModes.Group);
		expect(detail.lifecycle).toBe(ConversationLifecycles.Open);
		expect(detail.messages.map(message => message.id)).toEqual(["earlier", "later"]);
		expect(detail.messages[0]).toMatchObject({ role: MessageRoles.Assistant, state: MessageStates.Completed, source: MessageSources.ModelOutput });
	});

	it("rejects unknown categorical values instead of guessing", function _RejectsUnknown()
	{
		expect(function _InvalidDirectory() { _ConversationWorkspaceDirectory({ participants: [], personalAgentStatus: "mystery", personalAgent: null }); }).toThrow("invalid personal Agent status");
		expect(function _InvalidRun() { _ConversationRun({ runId: "run-1", attempt: 1, state: "mystery", conversationId: "conversation-1" }); }).toThrow("invalid run state");
		expect(_ConversationRun({ runId: "run-1", attempt: 1, state: "failed", conversationId: "conversation-1" }).state).toBe(ConversationRunStates.Failed);
	});
});
