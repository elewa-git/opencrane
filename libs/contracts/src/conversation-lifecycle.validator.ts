import { z } from "zod";

import { ConversationLifecycleModes, type ConversationCreated } from "./conversation-lifecycle.types";

/**
 * Validates the revision-zero conversation lifecycle event before a reader exposes later entries.
 *
 * A failed parse means the stream has no trusted creation record, so the history reader rejects it
 * instead of treating a participant event as the first record.
 */
export const ___ConversationCreatedSchema: z.ZodType<ConversationCreated> = z.object({
	schemaVersion: z.literal(1),
	conversationId: z.string().trim().min(1),
	mode: z.enum([ConversationLifecycleModes.Direct, ConversationLifecycleModes.Group, ConversationLifecycleModes.Agent]),
	participants: z.array(z.object({ userId: z.string().trim().min(1), visibleFromPosition: z.string().regex(/^(0|[1-9][0-9]*)$/u), joinedAt: z.string().datetime({ offset: true }) }).strict()).min(1),
	agentBinding: z.object({ agentServiceId: z.string().trim().min(1), agentRevisionId: z.string().trim().min(1), agentIdentityId: z.string().trim().min(1), profileRevisionId: z.string().trim().min(1), computerId: z.string().trim().min(1) }).strict().nullable(),
	createdAt: z.string().datetime({ offset: true }),
	provenance: z.object({ principalId: z.string().trim().min(1), authorizationEvidenceId: z.string().trim().min(1), requestId: z.string().uuid() }).strict(),
}).strict().superRefine(function _ValidateComputerBinding(created, context)
{
	if (created.mode === ConversationLifecycleModes.Agent && created.agentBinding === null)
		context.addIssue({ code: "custom", message: "agent conversation creation requires an agent binding" });
	if (created.mode !== ConversationLifecycleModes.Agent && created.agentBinding !== null)
		context.addIssue({ code: "custom", message: "human conversation creation cannot bind a computer" });
});
