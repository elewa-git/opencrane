import { z } from "zod";

import { __RoutineScheduleSchema } from "@opencrane/models/agents";

import type { RoutineControlRequest, RoutineCreateRequest, RoutineReviseRequest } from "./routine-command.types";

/** Accepts bounded opaque identifiers without normalising a caller's coordinate. */
export const ___RoutineIdentifierSchema = z.string().min(1).max(200).refine(function _NoSurroundingWhitespace(value): boolean { return value.trim() === value; });

/** Accepts one retry key after trimming its bounded opaque value. */
const _IdempotencyKeySchema = z.string().trim().min(1).max(200);

/** Validates the exact routine creation request accepted by the public API. */
export const ___RoutineCreateRequestSchema: z.ZodType<RoutineCreateRequest> = z.object({
	destinationConversationId: ___RoutineIdentifierSchema,
	audienceParticipantRefs: z.array(___RoutineIdentifierSchema).min(1).max(100).refine(function _Unique(values): boolean { return new Set(values).size === values.length; }),
	selectedManagedServiceId: ___RoutineIdentifierSchema,
	schedule: __RoutineScheduleSchema,
	instruction: z.string().trim().min(1).max(20_000),
	idempotencyKey: _IdempotencyKeySchema,
}).strict();

/** Validates the exact routine revision request accepted by the public API. */
export const ___RoutineReviseRequestSchema: z.ZodType<RoutineReviseRequest> = z.object({
	expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	expectedLifecycleRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	schedule: __RoutineScheduleSchema,
	instruction: z.string().trim().min(1).max(20_000),
	idempotencyKey: _IdempotencyKeySchema,
}).strict();

/** Validates the exact lifecycle or manual firing request accepted by the public API. */
export const ___RoutineControlRequestSchema: z.ZodType<RoutineControlRequest> = z.object({
	expectedLifecycleRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	idempotencyKey: _IdempotencyKeySchema,
}).strict();
