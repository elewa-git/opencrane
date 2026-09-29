import { z } from "zod";

import { RoutineFiringTrigger } from "@opencrane/models/agents";

import { ConversationGenesisOriginKinds, type ConversationGenesisOrigin } from "./conversation-genesis-origin.types";
import { ___GroupChildOriginSchema } from "./group-child.validator";

/** Preserves a bounded opaque identifier without trimming or rewriting saved evidence. */
const _Identifier = z.string().min(1).max(1024).refine(value => value.trim() === value);
/** Accepts only positive safe revision numbers. */
const _PositiveSafeRevision = z.number().int().positive().safe();
/** Shares exact routine-occurrence coordinates between the trigger-specific closed arms. */
const _RoutineOccurrenceShape = {
	kind: z.literal(ConversationGenesisOriginKinds.RoutineOccurrence),
	routineId: _Identifier,
	routineRevision: _PositiveSafeRevision,
	firingId: _Identifier,
	destinationConversationId: _Identifier,
} as const;
/** Requires an automatic firing to name its exact ISO-8601 schedule slot. */
const _AutomaticRoutineOccurrenceSchema = z.object({ ..._RoutineOccurrenceShape, trigger: z.literal(RoutineFiringTrigger.Automatic), scheduledSlot: z.string().datetime({ offset: true }) }).strict();
/** Forbids a schedule slot on an explicitly requested manual firing. */
const _ManualRoutineOccurrenceSchema = z.object({ ..._RoutineOccurrenceShape, trigger: z.literal(RoutineFiringTrigger.Manual), scheduledSlot: z.null() }).strict();
/** Adds only the origin discriminant while retaining the standalone group-child model unchanged. */
const _GroupChildConversationGenesisOriginSchema = ___GroupChildOriginSchema.extend({ kind: z.literal(ConversationGenesisOriginKinds.GroupChild) });

/** Validates the complete closed genesis-origin union and rejects unknown fields. */
export const ___ConversationGenesisOriginSchema: z.ZodType<ConversationGenesisOrigin> = z.union([_GroupChildConversationGenesisOriginSchema, _AutomaticRoutineOccurrenceSchema, _ManualRoutineOccurrenceSchema]);

/** Parses one saved genesis origin without coercing or normalising its evidence. @throws ZodError for invalid provenance. */
export function ___ParseConversationGenesisOrigin(value: unknown): ConversationGenesisOrigin
{
	return ___ConversationGenesisOriginSchema.parse(value);
}
