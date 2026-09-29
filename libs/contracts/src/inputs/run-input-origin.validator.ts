import { AgentRunTriggers } from "@opencrane/models/agents";
import { z } from "zod";

import type { RunInputOrigin } from "./run-input-snapshot.types";

/** Accepts nonblank persisted identifiers without normalizing digest-bound evidence. */
const _IdentifierSchema = z.string().refine(function _IsIdentifier(value): boolean { return value.trim().length > 0; });

/** Accepts only the canonical UTC instant used by database comparisons and snapshot digests. */
const _InstantSchema = z.string().refine(function _IsCanonicalInstant(value): boolean
{
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
});

/** Fields shared by automatic and manual routine origins. */
const _RoutineOriginFields = {
	routineId: _IdentifierSchema,
	routineRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	firingId: _IdentifierSchema,
	requesterPrincipalId: _IdentifierSchema,
	requesterIssuer: _IdentifierSchema,
	requesterSubjectId: _IdentifierSchema,
	requesterAuthenticatedAt: _InstantSchema,
	workflowTaskId: _IdentifierSchema,
	workflowTaskName: _IdentifierSchema,
	workflowTaskKey: _IdentifierSchema,
};

/** Validates exact persisted origin structure without making any cross-row authority decision. */
export const ___RunInputOriginSchema: z.ZodType<RunInputOrigin> = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal(AgentRunTriggers.Interactive), messageId: z.string().nullable(), historyRevision: z.string().nullable() }).strict(),
	z.object({ kind: z.literal(AgentRunTriggers.Scheduled), ..._RoutineOriginFields, scheduledSlot: _InstantSchema }).strict(),
	z.object({ kind: z.literal(AgentRunTriggers.Manual), ..._RoutineOriginFields, scheduledSlot: z.null() }).strict(),
]);
