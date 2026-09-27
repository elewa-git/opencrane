import { z } from "zod";

import { RoutineFiringReasons } from "@opencrane/contracts";

import { AgentRunTerminalReasons, RoutineFiringDisposition, RoutineFiringTrigger, RoutineStatus, type RoutineCreationOptions, type RoutineDefinition, type RoutineDetails, type RoutineFiringPage, type RoutineListPage, type RoutineSchedulePreview } from "./routine-gateway.types";

const _Identifier = z.string().min(1).max(200);
const _Cursor = z.string().regex(/^[A-Za-z0-9_-]+$/u).min(1).max(2_048);
const _Revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const _Schedule = z.object({ expression: z.string().min(1).max(256), timezone: z.string().min(1).max(128) }).strict();
const _Definition = z.object({ routineId: _Identifier, currentRevision: _Revision, status: z.nativeEnum(RoutineStatus), lifecycleRevision: _Revision, nextAutomaticOccurrence: z.string().datetime({ offset: true }).nullable() }).strict();
const _LastFiring = z.object({ firingId: _Identifier, routineRevision: _Revision, trigger: z.nativeEnum(RoutineFiringTrigger), disposition: z.nativeEnum(RoutineFiringDisposition), scheduledSlot: z.string().datetime({ offset: true }).nullable(), finishedAt: z.string().datetime({ offset: true }).nullable() }).strict();
const _ManagedService = z.object({ managedServiceId: _Identifier, displayName: z.string().min(1).max(200) }).strict();
const _Choice = z.object({ participantRef: _Identifier, displayName: z.string().min(1).max(200), isSelf: z.boolean() }).strict();
const _Capabilities = z.object({ revise: z.boolean(), pause: z.boolean(), resume: z.boolean(), retire: z.boolean(), runNow: z.boolean() }).strict();
const _ListItem = z.object({ ..._Definition.shape, ownership: z.enum(["owner", "audience"]), destinationConversationId: _Identifier, selectedManagedService: _ManagedService, schedule: _Schedule, lastAutomaticOccurrence: z.string().datetime({ offset: true }).nullable(), lastFiring: _LastFiring.nullable(), capabilities: _Capabilities }).strict();
const _Firing = z.object({ firingId: _Identifier, routineRevision: _Revision, trigger: z.nativeEnum(RoutineFiringTrigger), disposition: z.nativeEnum(RoutineFiringDisposition), scheduledSlot: z.string().datetime({ offset: true }).nullable(), createdAt: z.string().datetime({ offset: true }), finishedAt: z.string().datetime({ offset: true }).nullable(), reason: z.nativeEnum(RoutineFiringReasons).nullable(), runTerminalReason: z.nativeEnum(AgentRunTerminalReasons).nullable(), resultConversationId: _Identifier.nullable(), actualCost: z.object({ amount: z.string().min(1).max(64), currency: z.string().min(1).max(16) }).strict().nullable() }).strict();
const _CommandFiring = z.object({ firingId: _Identifier, routineId: _Identifier, routineRevision: _Revision, trigger: z.nativeEnum(RoutineFiringTrigger), disposition: z.nativeEnum(RoutineFiringDisposition), scheduledSlot: z.string().datetime({ offset: true }).nullable(), reason: z.nativeEnum(RoutineFiringReasons).nullable() }).strict();

/** Validates one committed routine definition envelope. */
export const ___RoutineDefinitionResponseSchema: z.ZodType<{ readonly routine: RoutineDefinition }> = z.object({ routine: _Definition }).strict();

/** Validates one immediate firing decision envelope. */
export const ___RoutineFiringResponseSchema: z.ZodType<{ readonly firing: import("./routine-gateway.types").RoutineFiring }> = z.object({ firing: _CommandFiring }).strict();

/** Validates one authorized routine detail envelope. */
export const ___RoutineDetailsResponseSchema: z.ZodType<{ readonly routine: RoutineDetails }> = z.object({ routine: _ListItem.extend({ audienceParticipantRefs: z.array(_Identifier).min(1).max(100).refine(function _Unique(values): boolean { return new Set(values).size === values.length; }), audienceChoices: z.array(_Choice).min(1).max(100), instruction: z.string().min(1).max(20_000) }) }).strict();

/** Validates one sparse routine page, including an optional opaque continuation. */
export const ___RoutineListPageSchema: z.ZodType<RoutineListPage> = z.object({ items: z.array(_ListItem), limit: z.number().int().min(1).max(25), nextCursor: _Cursor.optional() }).strict();

/** Validates one sparse firing-history page, including an optional opaque continuation. */
export const ___RoutineFiringPageSchema: z.ZodType<RoutineFiringPage> = z.object({ items: z.array(_Firing), limit: z.number().int().min(1).max(25), nextCursor: _Cursor.optional() }).strict();

/** Validates destination-scoped creation choices. */
export const ___RoutineCreationOptionsSchema: z.ZodType<RoutineCreationOptions> = z.object({ destinationConversationId: _Identifier, audienceChoices: z.array(_Choice), managedServiceChoices: z.array(_ManagedService) }).strict();

/** Validates a normalized schedule preview. */
export const ___RoutineSchedulePreviewSchema: z.ZodType<RoutineSchedulePreview> = z.object({ schedule: _Schedule, calculatedAt: z.string().datetime({ offset: true }), nextOccurrences: z.array(z.string().datetime({ offset: true })).length(5) }).strict();
