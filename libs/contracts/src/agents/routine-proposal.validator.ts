import { z } from "zod";

import { __RoutineScheduleSchema } from "@opencrane/models/agents";

import type { RoutineProposalReadResponse, RoutineProposalSuggestion } from "./routine-proposal.types";
import { RoutineProposalStates } from "./routine-proposal.types";
import { ___RoutineIdentifierSchema } from "./routine-command.validator";

/** Validates the requester-facing suggestion without accepting authority or proposal coordinates. */
export const ___RoutineProposalSuggestionSchema: z.ZodType<RoutineProposalSuggestion> = z.object({
	instruction: z.string().trim().min(1).max(20_000),
	schedule: __RoutineScheduleSchema,
}).strict();

const _ProjectionBase = {
	proposalRef: ___RoutineIdentifierSchema,
	sourceConversationId: ___RoutineIdentifierSchema,
	suggestion: ___RoutineProposalSuggestionSchema,
	expiresAt: z.string().datetime(),
};

/** Validates the requester-only projection and keeps accepted routine identity state-specific. */
export const ___RoutineProposalReadResponseSchema: z.ZodType<RoutineProposalReadResponse> = z.discriminatedUnion("state", [
	z.object({ ..._ProjectionBase, state: z.literal(RoutineProposalStates.Pending) }).strict(),
	z.object({ ..._ProjectionBase, state: z.literal(RoutineProposalStates.Accepted), acceptedRoutineId: ___RoutineIdentifierSchema }).strict(),
	z.object({ ..._ProjectionBase, state: z.literal(RoutineProposalStates.Cancelled) }).strict(),
	z.object({ ..._ProjectionBase, state: z.literal(RoutineProposalStates.Expired) }).strict(),
]);
