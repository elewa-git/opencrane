// Turns untrusted values from storage or the API into message models. It lives beside the model so the provenance and completion rules change together with the types.
import { z } from "zod";

import { __HasValidMessageCompletion } from "./conversation-invariants";
import { MessageContentBlockKinds, MessageRoles, MessageSources, MessageStates, type Message, type MessageContentBlock } from "./message.types";

/** Non-empty OpenCrane-owned identifier accepted at the message boundary. */
const _IdentifierSchema = z.string().trim().min(1);

/** Strict validator for one stable canonical message content block. */
const _MessageContentBlockSchema: z.ZodType<MessageContentBlock> = z.object({ id: _IdentifierSchema, kind: z.nativeEnum(MessageContentBlockKinds), value: z.string() }).strict();

/** Validates a message's content blocks: between 1 and 32 blocks, each value at most 32000 characters, and every block id unique. */
const _MessageContentBlocksSchema: z.ZodType<readonly MessageContentBlock[]> = z.array(_MessageContentBlockSchema).min(1).max(32).superRefine(function _ValidateBlockValues(blocks, context)
{
	if (blocks.some(block => block.value.length > 32_000)) context.addIssue({ code: z.ZodIssueCode.custom, message: "message block value exceeds 32000 characters" });
	if (new Set(blocks.map(function _BlockId(block): string { return block.id; })).size !== blocks.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "message block identifiers must be unique" });
});

/**
 * Validates content blocks submitted by a person, allowing only text and artifact blocks.
 *
 * Tool-call and tool-result blocks are refused here so a participant cannot post content that
 * renders as if a tool produced it. Use this for participant input; use {@link ___MessageSchema}
 * for a whole stored message.
 */
export const ___ParticipantInputBlocksSchema: z.ZodType<readonly MessageContentBlock[]> = _MessageContentBlocksSchema.superRefine(function _ValidateParticipantKinds(blocks, context)
{
	if (blocks.some(block => block.kind !== MessageContentBlockKinds.Text && block.kind !== MessageContentBlockKinds.Artifact)) context.addIssue({ code: z.ZodIssueCode.custom, message: "participant input supports only text and artifact blocks" });
});

/** Strict validator for canonical durable conversation messages. */
export const ___MessageSchema: z.ZodType<Message> = z.object({
	id: _IdentifierSchema,
	conversationId: _IdentifierSchema,
	role: z.nativeEnum(MessageRoles),
	state: z.nativeEnum(MessageStates),
	source: z.nativeEnum(MessageSources),
	blocks: _MessageContentBlocksSchema,
	runId: _IdentifierSchema.nullable(),
	userId: _IdentifierSchema.nullable(),
	idempotencyKey: _IdentifierSchema,
	createdAt: z.string().datetime({ offset: true }),
	completedAt: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine(function _ValidateMessageCompletion(message, context)
{
	if (!__HasValidMessageCompletion(message))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "must be present exactly when message state is terminal" });
	}
});
