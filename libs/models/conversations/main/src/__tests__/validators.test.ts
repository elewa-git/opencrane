import { describe, expect, it } from "vitest";

import { ___ConversationCreationRequestSchema, ___ConversationParticipantSchema, ___ConversationReplayCursorSchema, ___ConversationSchema, ___ConversationTimelineEntrySchema, ___MessageSchema, ___ParticipantInputBlocksSchema, ConversationLifecycles, ConversationModes, ConversationTimelineEntryKinds, MessageContentBlockKinds, MessageRoles, MessageSources, MessageStates } from "../index";

/** Builds one valid exact immutable-mode conversation value. */
function _conversation(mode: ConversationModes): Record<string, unknown>
{
	const common = { id: "conversation-1", siloId: "silo-1", mode, lifecycle: ConversationLifecycles.Open, contextRevisionId: null, closedAt: null, createdAt: "2026-08-10T08:00:00.000Z", updatedAt: "2026-08-10T08:00:00.000Z" };
	return mode === ConversationModes.AgentSession ? { ...common, agentServiceId: "agent-service-1" } : common;
}

/** Builds one valid canonical durable message value. */
function _message(): Record<string, unknown>
{
	return {
		id: "message-1",
		conversationId: "conversation-1",
		role: MessageRoles.User,
		state: MessageStates.Completed,
		source: MessageSources.UserInput,
		blocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }],
		runId: null,
		userId: "user-1",
		idempotencyKey: "message-request-1",
		createdAt: "2026-08-10T08:00:00.000Z",
		completedAt: "2026-08-10T08:00:01.000Z",
	};
}

describe("conversation model validators", function _ConversationValidatorSuite()
{
	it("accepts every supported exact mode branch", function _AcceptsModes()
	{
		for (const mode of Object.values(ConversationModes))
		{
			expect(___ConversationSchema.parse(_conversation(mode)).mode).toBe(mode);
		}
	});

	it("rejects missing, forbidden, and unknown agent bindings", function _RejectsBindings()
	{
		const agentSession = _conversation(ConversationModes.AgentSession);
		const direct = _conversation(ConversationModes.Direct);

		expect(___ConversationSchema.safeParse({ ...agentSession, agentServiceId: undefined }).success).toBe(false);
		expect(___ConversationSchema.safeParse({ ...direct, agentServiceId: "agent-service-1" }).success).toBe(false);
		expect(___ConversationSchema.safeParse({ ...direct, unexpected: true }).success).toBe(false);
		expect(___ConversationSchema.safeParse({ ...direct, lifecycle: ConversationLifecycles.Closed, closedAt: null }).success).toBe(false);
		expect(___ConversationSchema.safeParse({ ...direct, lifecycle: ConversationLifecycles.Closed, closedAt: "2026-08-10T09:00:00.000Z" }).success).toBe(true);
	});

	it("validates creation requests against the shared immutable-mode vocabulary", function _ValidatesCreationRequests()
	{
		expect(___ConversationCreationRequestSchema.safeParse({ mode: ConversationModes.AgentSession, agentServiceId: "agent-service-1" }).success).toBe(true);
		expect(___ConversationCreationRequestSchema.safeParse({ mode: ConversationModes.Direct, participantUserIds: ["user-2"] }).success).toBe(true);
		expect(___ConversationCreationRequestSchema.safeParse({ mode: ConversationModes.Group, participantUserIds: ["user-2", "user-3"] }).success).toBe(true);
		expect(___ConversationCreationRequestSchema.safeParse({ mode: ConversationModes.Direct, participantUserIds: ["user-2", "user-3"] }).success).toBe(false);
		expect(___ConversationCreationRequestSchema.safeParse({ mode: ConversationModes.AgentSession, agentServiceId: "agent-service-1", participantUserIds: ["user-2"] }).success).toBe(false);
	});

	it("keeps participant visibility positive while allowing canonical zero for unread", function _ParticipantCoordinates()
	{
		const participant = { conversationId: "conversation-1", userId: "user-1", visibleFromPosition: "4", readThroughPosition: "0", archivedAt: null, accessEndedPosition: null };

		expect(___ConversationParticipantSchema.safeParse(participant).success).toBe(true);
		expect(___ConversationParticipantSchema.safeParse({ ...participant, visibleFromPosition: "0" }).success).toBe(false);
		expect(___ConversationParticipantSchema.safeParse({ ...participant, readThroughPosition: "01" }).success).toBe(false);
	});

	it("requires completion time exactly for terminal message states", function _MessageCompletion()
	{
		const message = _message();

		expect(___MessageSchema.safeParse(message).success).toBe(true);
		expect(___MessageSchema.safeParse({ ...message, completedAt: null }).success).toBe(false);
		expect(___MessageSchema.safeParse({ ...message, state: MessageStates.Streaming }).success).toBe(false);
		expect(___MessageSchema.safeParse({ ...message, idempotencyKey: "" }).success).toBe(false);
	});

	it("rejects participant-authored tool presentation blocks", function _RejectsToolSpoofing()
	{
		expect(___ParticipantInputBlocksSchema.safeParse([{ id: "block-1", kind: MessageContentBlockKinds.ToolCall, value: "pretend" }]).success).toBe(false);
		expect(___ParticipantInputBlocksSchema.safeParse([{ id: "block-1", kind: MessageContentBlockKinds.Artifact, value: "artifact-revision-1" }]).success).toBe(true);
	});

	it("binds timeline entries and replay cursors to conversation positions", function _TimelineCoordinates()
	{
		const entry = { conversationId: "conversation-1", position: "1", kind: ConversationTimelineEntryKinds.Message, messageId: "message-1", payload: null, occurredAt: "2026-08-10T08:00:00.000Z" };
		const parentDelivery = { conversationId: "conversation-1", position: "2", kind: ConversationTimelineEntryKinds.ParentDelivery, parentDeliveryAgentThreadId: "delivery-1", payload: null, occurredAt: "2026-08-10T08:00:01.000Z" };

		expect(___ConversationTimelineEntrySchema.safeParse(entry).success).toBe(true);
		expect(___ConversationTimelineEntrySchema.safeParse(parentDelivery).success).toBe(true);
		for (const invalidPosition of ["0", "01", "+1", "-1", "1.5", 1])
		{
			expect(___ConversationTimelineEntrySchema.safeParse({ ...entry, position: invalidPosition }).success).toBe(false);
			expect(___ConversationReplayCursorSchema.safeParse({ conversationId: "conversation-1", position: invalidPosition }).success).toBe(false);
		}
		expect(___ConversationReplayCursorSchema.safeParse({ conversationId: "conversation-1", position: "9007199254740993" }).success).toBe(true);
		expect(___ConversationReplayCursorSchema.safeParse({ conversationId: "conversation-1", position: "9007199254740993", subframe: 2 }).success).toBe(true);
		expect(___ConversationReplayCursorSchema.safeParse({ conversationId: "conversation-1", position: "9007199254740993", subframe: -1 }).success).toBe(false);
	});
});
