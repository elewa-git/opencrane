// Turns untrusted values from storage or the API into conversation models. It lives beside the model so the mode and agent-binding rules cannot drift apart from the types.
import { z } from "zod";

import { ConversationLifecycles, ConversationModes, type Conversation, type ConversationCreationRequest, type ConversationParticipant } from "./conversation.types";

/** Non-empty OpenCrane-owned identifier accepted at the model boundary. */
const _IdentifierSchema = z.string().trim().min(1);

/** ISO-8601 instant accepted at the model boundary. */
const _InstantSchema = z.string().datetime({ offset: true });

/** Canonical positive decimal representation of a database-owned BigInt position. */
const _PositionSchema = z.string().regex(/^[1-9]\d*$/, "must be a canonical positive decimal string");

/** A non-negative position as a decimal string, used by `readThroughPosition` where `"0"` means unread. */
const _ReadPositionSchema = z.string().regex(/^(0|[1-9]\d*)$/, "must be a canonical non-negative decimal string");

/** Fields shared by each exact immutable-mode conversation validator. */
const _ConversationBaseShape = {
	id: _IdentifierSchema,
	siloId: _IdentifierSchema,
	lifecycle: z.nativeEnum(ConversationLifecycles),
	contextRevisionId: _IdentifierSchema.nullable(),
	closedAt: _InstantSchema.nullable(),
	createdAt: _InstantSchema,
	updatedAt: _InstantSchema,
};

/** Exact agent-session branch requiring one agent-service binding. */
const _AgentSessionConversationSchema = z.object({ ..._ConversationBaseShape, mode: z.literal(ConversationModes.AgentSession), agentServiceId: _IdentifierSchema }).strict();

/** Exact direct branch prohibiting an agent-service binding. */
const _DirectConversationSchema = z.object({ ..._ConversationBaseShape, mode: z.literal(ConversationModes.Direct) }).strict();

/** Exact group branch prohibiting an agent-service binding. */
const _GroupConversationSchema = z.object({ ..._ConversationBaseShape, mode: z.literal(ConversationModes.Group) }).strict();

/** Exact agent-session creation branch requiring one agent-service binding. */
const _AgentSessionCreationSchema = z.object({ mode: z.literal(ConversationModes.AgentSession), agentServiceId: _IdentifierSchema }).strict();

/** Exact direct creation branch requiring one other participant. */
const _DirectCreationSchema = z.object({ mode: z.literal(ConversationModes.Direct), participantUserIds: z.array(_IdentifierSchema).length(1) }).strict();

/** Exact group creation branch accepting one to ninety-nine other participants. */
const _GroupCreationSchema = z.object({ mode: z.literal(ConversationModes.Group), participantUserIds: z.array(_IdentifierSchema).min(1).max(99) }).strict();

/** Validates a stored conversation. Rejects unknown fields, and requires `closedAt` to be set exactly when the lifecycle is closed. */
export const ___ConversationSchema: z.ZodType<Conversation> = z.discriminatedUnion("mode", [_AgentSessionConversationSchema, _DirectConversationSchema, _GroupConversationSchema]).superRefine(function _ValidateClosedAt(conversation, context)
{
	const isOpenWithoutClosure = conversation.lifecycle === ConversationLifecycles.Open && conversation.closedAt === null;
	const isClosedWithClosure = conversation.lifecycle === ConversationLifecycles.Closed && conversation.closedAt !== null;
	if (!isOpenWithoutClosure && !isClosedWithClosure)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["closedAt"], message: "must be present exactly when lifecycle is closed" });
	}
});

/** Validates a conversation-creation request, applying the per-mode participant rules. */
export const ___ConversationCreationRequestSchema: z.ZodType<ConversationCreationRequest> = z.discriminatedUnion("mode", [_AgentSessionCreationSchema, _DirectCreationSchema, _GroupCreationSchema]);

/** Validates one participant's own record: visibility start, read position, archive time, and access end. */
export const ___ConversationParticipantSchema: z.ZodType<ConversationParticipant> = z.object({
	conversationId: _IdentifierSchema,
	userId: _IdentifierSchema,
	visibleFromPosition: _PositionSchema,
	readThroughPosition: _ReadPositionSchema,
	archivedAt: _InstantSchema.nullable(),
	accessEndedPosition: _PositionSchema.nullable(),
}).strict();
