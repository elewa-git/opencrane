import { z } from "zod";

import { __RoutineScheduleSchema } from "@opencrane/models/agents";

import type { RoutineSchedulePreviewRequest } from "./routine-read.types";

/** Bounded opaque encrypted cursor token accepted from a browser query. */
export const ___RoutineCursorSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u).min(1).max(2_048);

/** Cursor-paginated routine list query. */
const _LimitSchema = z.preprocess(function _DefaultLimit(value): unknown { return value === undefined ? "20" : value; }, z.string().regex(/^(?:[1-9]|1[0-9]|2[0-5])$/u).transform(Number));

/** Cursor-paginated routine list query. */
export const ___RoutineListQuerySchema = z.object({ limit: _LimitSchema, cursor: ___RoutineCursorSchema.optional() }).strict();

/** Cursor-paginated firing history query. */
export const ___RoutineFiringListQuerySchema = ___RoutineListQuerySchema;

/** Destination conversation identifier used to resolve creation choices. */
export const ___RoutineCreationOptionsQuerySchema = z.object({ destinationConversationId: z.string().min(1).max(200).refine(function _NoSurroundingWhitespace(value): boolean { return value.trim() === value; }) }).strict();

/** Validates the schedule-only preview request without accepting caller identity. */
export const ___RoutineSchedulePreviewRequestSchema: z.ZodType<RoutineSchedulePreviewRequest> = z.object({ schedule: __RoutineScheduleSchema }).strict();
