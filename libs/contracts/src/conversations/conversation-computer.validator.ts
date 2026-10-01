// HTTP readers validate this projection beside its shared model before adopting computer state.
// Extra fields are rejected because this public shape must never carry sandbox credentials.
import { z } from "zod";

import { ConversationComputerStates, type ConversationComputer } from "./conversation-computer.types";

/** Requires a server-selected coordinate without accepting empty or whitespace-only values. */
const _Coordinate = z.string().min(1).refine(function _NotBlank(value) { return value.trim().length > 0; });

/**
 * Validates the existing logical computer projection, including its identity and lease generation.
 * This structural check grants no authority; callers must also bind conversationId to their request.
 * @see ConversationComputer
 */
export const ___ConversationComputerSchema: z.ZodType<ConversationComputer> = z.object({
	schemaVersion: z.literal(1),
	id: _Coordinate,
	siloId: _Coordinate,
	conversationId: _Coordinate,
	agentIdentityId: _Coordinate,
	profileRevisionId: _Coordinate,
	state: z.nativeEnum(ConversationComputerStates),
	leaseGeneration: z.number().int().nonnegative().safe(),
	workspaceCheckpoint: z.object({ artifactRevisionId: _Coordinate, digest: _Coordinate, format: _Coordinate, checkpointedAt: z.string().datetime() }).strict().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime()
}).strict();
