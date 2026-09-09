import { z } from "zod";

import { ConversationModes } from "@opencrane/models/conversations";

import type { OrdinaryConversationCreateCommand } from "./conversation-metadata.types";

/** Rejects malformed or identity-bearing requests before the metadata authority starts any work. */
const _OrdinaryCreationSchema: z.ZodType<OrdinaryConversationCreateCommand> = z.object({
	mode: z.union([z.literal(ConversationModes.Direct), z.literal(ConversationModes.Group)]),
	participantRefs: z.array(z.string().min(1)).min(1).max(99),
	idempotencyKey: z.string().uuid(),
}).strict().refine(function _ValidParticipants(command)
{
	return new Set(command.participantRefs).size === command.participantRefs.length && (command.mode !== ConversationModes.Direct || command.participantRefs.length === 1);
});

/** Returns a checked creation request, or null for an invalid request without starting persistence. */
export function _ParseOrdinaryConversationCreateCommand(value: unknown): OrdinaryConversationCreateCommand | null
{
	const parsed = _OrdinaryCreationSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
