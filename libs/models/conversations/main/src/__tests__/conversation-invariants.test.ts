import { describe, expect, it } from "vitest";

import { __CanAppendConversationTimelineEntry, __HasValidConversationAgentBinding, __IsConversationLifecycleTransitionAllowed, __IsMessageTransitionAllowed, ConversationLifecycles, ConversationModes, ConversationTimelineEntryKinds, MessageStates } from "../index";
import type { ConversationTimelineEntry } from "../index";

/** Creates one canonical timeline entry for append-order tests. */
function _entry(conversationId: string, position: string): ConversationTimelineEntry
{
	return { conversationId, position, kind: ConversationTimelineEntryKinds.Message, messageId: `message-${position}`, payload: null, occurredAt: "2026-08-10T08:00:00.000Z" };
}

describe("conversation model invariants", function _ConversationInvariantSuite()
{
	it("requires exactly one agent binding only for agent sessions", function _AgentBinding()
	{
		expect(__HasValidConversationAgentBinding(ConversationModes.AgentSession, "agent-service-1")).toBe(true);
		expect(__HasValidConversationAgentBinding(ConversationModes.AgentSession, null)).toBe(false);
		expect(__HasValidConversationAgentBinding(ConversationModes.AgentSession, " ")).toBe(false);
		expect(__HasValidConversationAgentBinding(ConversationModes.Direct, null)).toBe(true);
		expect(__HasValidConversationAgentBinding(ConversationModes.Direct, undefined)).toBe(true);
		expect(__HasValidConversationAgentBinding(ConversationModes.Direct, "agent-service-1")).toBe(false);
		expect(__HasValidConversationAgentBinding(ConversationModes.Group, null)).toBe(true);
		expect(__HasValidConversationAgentBinding(ConversationModes.Group, "agent-service-1")).toBe(false);
	});

	it("allows only the monotonic open-to-closed lifecycle transition", function _Lifecycle()
	{
		expect(__IsConversationLifecycleTransitionAllowed(ConversationLifecycles.Open, ConversationLifecycles.Closed)).toBe(true);
		expect(__IsConversationLifecycleTransitionAllowed(ConversationLifecycles.Open, ConversationLifecycles.Open)).toBe(false);
		expect(__IsConversationLifecycleTransitionAllowed(ConversationLifecycles.Closed, ConversationLifecycles.Open)).toBe(false);
		expect(__IsConversationLifecycleTransitionAllowed(ConversationLifecycles.Closed, ConversationLifecycles.Closed)).toBe(false);
	});

	it("keeps terminal messages terminal", function _MessageLifecycle()
	{
		expect(__IsMessageTransitionAllowed(MessageStates.Pending, MessageStates.Streaming)).toBe(true);
		expect(__IsMessageTransitionAllowed(MessageStates.Streaming, MessageStates.Completed)).toBe(true);
		expect(__IsMessageTransitionAllowed(MessageStates.Completed, MessageStates.Streaming)).toBe(false);
		expect(__IsMessageTransitionAllowed(MessageStates.Failed, MessageStates.Completed)).toBe(false);
		expect(__IsMessageTransitionAllowed(MessageStates.Cancelled, MessageStates.Pending)).toBe(false);
	});

	it("requires one-based contiguous positions in one conversation", function _TimelineOrdering()
	{
		expect(__CanAppendConversationTimelineEntry(null, _entry("conversation-1", "1"))).toBe(true);
		expect(__CanAppendConversationTimelineEntry(null, _entry("conversation-1", "0"))).toBe(false);
		expect(__CanAppendConversationTimelineEntry(null, _entry("conversation-1", "2"))).toBe(false);
		expect(__CanAppendConversationTimelineEntry(_entry("conversation-1", "1"), _entry("conversation-1", "2"))).toBe(true);
		expect(__CanAppendConversationTimelineEntry(_entry("conversation-1", "1"), _entry("conversation-1", "3"))).toBe(false);
		expect(__CanAppendConversationTimelineEntry(_entry("conversation-1", "1"), _entry("conversation-2", "2"))).toBe(false);
		expect(__CanAppendConversationTimelineEntry(_entry("conversation-1", "1"), _entry("conversation-1", "1.5"))).toBe(false);
		expect(__CanAppendConversationTimelineEntry(_entry("conversation-1", "9007199254740992"), _entry("conversation-1", "9007199254740993"))).toBe(true);
	});
});
