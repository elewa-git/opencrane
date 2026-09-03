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
	participants: z.array(z.object({ userId: z.string().trim().min(1), visibleFromPosition: z.string().regex(/^[1-9][0-9]*$/u), joinedAt: z.string().datetime({ offset: true }) }).strict()).min(1),
	agentBinding: z.object({ agentServiceId: z.string().trim().min(1), agentRevisionId: z.string().trim().min(1), agentIdentityId: z.string().trim().min(1), profileRevisionId: z.string().trim().min(1), computerId: z.string().trim().min(1) }).strict().nullable(),
	createdAt: z.string().datetime({ offset: true }),
	provenance: z.object({ principalId: z.string().trim().min(1), authorizationEvidenceId: z.string().trim().min(1), requestId: z.string().uuid() }).strict(),
}).strict().superRefine(
	/**
	 * Enforces creation relationships that field validators cannot express.
	 *
	 * The baseline allocates initial participant positions as a positive sequence, so replay must
	 * retain that order to rebuild the same `ConversationParticipant` coordinates. The mode decides
	 * whether the event requires an agent binding or prohibits a computer.
	 */
	function _ValidateComputerBinding(created, context)
{
	const participantIds = new Set<string>();
	for (const [index, participant] of created.participants.entries())
	{
		if (participantIds.has(participant.userId))
			context.addIssue({ code: "custom", message: "conversation creation cannot repeat an initial participant" });
		participantIds.add(participant.userId);
		if (participant.visibleFromPosition !== (index + 1).toString())
			context.addIssue({ code: "custom", message: "conversation creation participants require sequential positive visibility positions" });
	}
	if (created.mode === ConversationLifecycleModes.Direct && created.participants.length !== 2)
		context.addIssue({ code: "custom", message: "direct conversation creation requires exactly two participants" });
	if (created.mode === ConversationLifecycleModes.Group && created.participants.length < 2)
		context.addIssue({ code: "custom", message: "group conversation creation requires at least two participants" });
	if (created.mode === ConversationLifecycleModes.Agent && created.participants.length !== 1)
		context.addIssue({ code: "custom", message: "agent conversation creation requires exactly one human participant" });
	if (created.mode === ConversationLifecycleModes.Agent && created.agentBinding === null)
		context.addIssue({ code: "custom", message: "agent conversation creation requires an agent binding" });
	if (created.mode !== ConversationLifecycleModes.Agent && created.agentBinding !== null)
		context.addIssue({ code: "custom", message: "human conversation creation cannot bind a computer" });
});
