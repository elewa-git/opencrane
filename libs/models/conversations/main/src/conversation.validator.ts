// This validator admits untrusted durable/API values into the conversation model; it stays beside the model so immutable mode and agent-binding rules cannot drift.
import { z } from "zod";

import { ConversationLifecycles, ConversationModes, type Conversation, type ConversationParticipant } from "./conversation.types.js";

/** Non-empty OpenCrane-owned identifier accepted at the model boundary. */
const _IdentifierSchema = z.string().trim().min(1);

/** ISO-8601 instant accepted at the model boundary. */
const _InstantSchema = z.string().datetime({ offset: true });

/** Canonical positive decimal representation of a database-owned BigInt position. */
const _PositionSchema = z.string().regex(/^[1-9]\d*$/, "must be a canonical positive decimal string");

/** Canonical non-negative decimal representation used by the unread participant coordinate. */
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

/** Strict validator for the canonical immutable-mode conversation union. */
export const ___ConversationSchema: z.ZodType<Conversation> = z.discriminatedUnion("mode", [_AgentSessionConversationSchema, _DirectConversationSchema, _GroupConversationSchema]).superRefine(function _ValidateClosedAt(conversation, context)
{
	const isOpenWithoutClosure = conversation.lifecycle === ConversationLifecycles.Open && conversation.closedAt === null;
	const isClosedWithClosure = conversation.lifecycle === ConversationLifecycles.Closed && conversation.closedAt !== null;
	if (!isOpenWithoutClosure && !isClosedWithClosure)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["closedAt"], message: "must be present exactly when lifecycle is closed" });
	}
});

/** Strict validator for participant-local join, read, archive, and access coordinates. */
export const ___ConversationParticipantSchema: z.ZodType<ConversationParticipant> = z.object({
	conversationId: _IdentifierSchema,
	userId: _IdentifierSchema,
	visibleFromPosition: _PositionSchema,
	readThroughPosition: _ReadPositionSchema,
	archivedAt: _InstantSchema.nullable(),
	accessEndedPosition: _PositionSchema.nullable(),
}).strict();
