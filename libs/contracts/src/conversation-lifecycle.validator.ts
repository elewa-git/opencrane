import { z } from "zod";

import { ConversationLifecycleModes, type ConversationCreated } from "./conversation-lifecycle.types";

/** Parses the immutable conversation-stream creation anchor before a reader exposes participant entries. */
export const ___ConversationCreatedSchema: z.ZodType<ConversationCreated> = z.object({
	schemaVersion: z.literal(1),
	conversationId: z.string().trim().min(1),
	mode: z.enum([ConversationLifecycleModes.Agent, ConversationLifecycleModes.Group]),
	createdAt: z.string().datetime({ offset: true }),
	provenance: z.object({ principalId: z.string().trim().min(1), authorizationEvidenceId: z.string().trim().min(1) }).strict(),
}).strict();
