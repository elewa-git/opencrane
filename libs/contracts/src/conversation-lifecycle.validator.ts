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
	mode: z.enum([ConversationLifecycleModes.Agent, ConversationLifecycleModes.Group]),
	createdAt: z.string().datetime({ offset: true }),
	provenance: z.object({ principalId: z.string().trim().min(1), authorizationEvidenceId: z.string().trim().min(1) }).strict(),
}).strict();
