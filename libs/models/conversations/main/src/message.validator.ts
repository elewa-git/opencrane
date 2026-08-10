// This validator admits untrusted durable/API values into canonical messages; it stays beside the model so provenance and completion invariants change together.
import { z } from "zod";

import { __HasValidMessageCompletion } from "./conversation-invariants.js";
import { MessageContentBlockKinds, MessageRoles, MessageSources, MessageStates, type Message, type MessageContentBlock } from "./message.types.js";

/** Non-empty OpenCrane-owned identifier accepted at the message boundary. */
const _IdentifierSchema = z.string().trim().min(1);

/** Strict validator for one stable canonical message content block. */
const _MessageContentBlockSchema: z.ZodType<MessageContentBlock> = z.object({ id: _IdentifierSchema, kind: z.nativeEnum(MessageContentBlockKinds), value: z.string() }).strict();

/** Strict validator for one bounded, non-empty participant message payload. */
const _MessageContentBlocksSchema: z.ZodType<readonly MessageContentBlock[]> = z.array(_MessageContentBlockSchema).min(1).max(32).superRefine(function _ValidateBlockValues(blocks, context)
{
	if (blocks.some(block => block.value.length > 32_000)) context.addIssue({ code: z.ZodIssueCode.custom, message: "message block value exceeds 32000 characters" });
	if (new Set(blocks.map(function _BlockId(block): string { return block.id; })).size !== blocks.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "message block identifiers must be unique" });
});

/** Strict input boundary that prevents participant-authored tool-output impersonation. */
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
