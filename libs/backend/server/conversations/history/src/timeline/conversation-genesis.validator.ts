import { z } from "zod";

import { ConversationGenesisOriginKinds, ___ConversationGenesisOriginSchema } from "@opencrane/models/conversations";

import { ConversationHistoryModes, type ConversationHistoryGenesis } from "./conversation-history-reader.types";

/** Preserves bounded immutable identifiers without trimming saved evidence. */
const _Identifier = z.string().min(1).max(1024).refine(value => value.trim() === value);

/** Validates the complete immutable revision-zero model shared by history reads and writes. */
const _ConversationHistoryGenesisSchema: z.ZodType<ConversationHistoryGenesis> = z.object({
	origin: ___ConversationGenesisOriginSchema.optional(),
	schemaVersion: z.literal(1),
	conversationId: _Identifier,
	siloId: _Identifier,
	mode: z.nativeEnum(ConversationHistoryModes),
	agentServiceId: _Identifier.nullable(),
	createdByPrincipalId: _Identifier,
	createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine(function _Relationships(genesis, context)
{
	const agentSession = genesis.mode === ConversationHistoryModes.AgentSession;
	if (agentSession !== (genesis.agentServiceId !== null))
	{
		context.addIssue({ code: z.ZodIssueCode.custom, message: "genesis mode and service binding disagree" });
	}
	if (genesis.origin !== undefined && !agentSession)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, message: "only an agent session can carry an origin", path: ["origin"] });
	}
	if (genesis.origin?.kind === ConversationGenesisOriginKinds.GroupChild && genesis.origin.parentConversationId === genesis.conversationId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, message: "a group child cannot name itself as parent", path: ["origin", "parentConversationId"] });
	}
	if (genesis.origin?.kind === ConversationGenesisOriginKinds.RoutineOccurrence && genesis.origin.destinationConversationId === genesis.conversationId)
	{
		context.addIssue({ code: z.ZodIssueCode.custom, message: "a routine occurrence cannot name itself as destination", path: ["origin", "destinationConversationId"] });
	}
});

/** Parses one complete saved genesis without compatibility fallbacks or evidence normalisation. */
export function _ParseConversationHistoryGenesis(value: unknown): ConversationHistoryGenesis
{
	return _ConversationHistoryGenesisSchema.parse(value);
}
