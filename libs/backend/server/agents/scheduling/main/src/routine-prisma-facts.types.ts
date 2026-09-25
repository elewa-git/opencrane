import type { Prisma } from "@prisma/client";

import type { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { RoutineStatus, RoutineUnfinishedFiringDisposition } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { RoutineCaller } from "./routine-authority.types";
import type { _ROUTINE_REVISION_SELECT, _ROUTINE_SELECT } from "./routine-prisma-selects";

/** Routine row loaded through the shared exact select. */
export type RoutineRow = Prisma.AgentRoutineGetPayload<{ readonly select: typeof _ROUTINE_SELECT }>;

/** Immutable revision row loaded through the shared exact select. */
export type RoutineRevisionRow = Prisma.AgentRoutineRevisionGetPayload<{ readonly select: typeof _ROUTINE_REVISION_SELECT }>;

/** Current aggregate and revision loaded under one transaction snapshot. */
export interface CurrentRoutineRows
{
	/** Mutable routine lifecycle and cursor row. */
	readonly routine: RoutineRow;
	/** Immutable revision named by the routine row. */
	readonly revision: RoutineRevisionRow;
}

/** Active managed-agent coordinates rechecked before every occurrence. */
export interface CurrentManagedAgent
{
	/** Stable managed service. */
	readonly serviceId: string;
	/** Current published revision used by this occurrence. */
	readonly revisionId: string;
	/** Internal Principal used for the managed agent's own execution grants. */
	readonly principalId: string;
}

/** Trusted actor recorded beside a firing effect admission. */
export interface RoutineFiringActor
{
	/** Manual work is user-initiated; automatic work is initiated by the durable scheduler. */
	readonly actorKind: "user" | "system";
	/** Stable human Principal or reviewed server actor profile. */
	readonly actorId: string;
}

/** Transaction-scoped current facts consumed by routine persistence repositories. */
export interface RoutineFactsRepository
{
	/** Reads the database authority clock. */
	databaseNow(): Promise<Date>;
	/** Loads the current aggregate and immutable revision. */
	current(siloId: string, routineId: string): Promise<CurrentRoutineRows | null>;
	/** Requires the exact original requester coordinates. */
	requireOriginalRequester(caller: RoutineCaller, routine: RoutineRow): void;
	/** Resolves the fixed audience from an existing readable conversation. */
	resolveCreationAudience(caller: RoutineCaller, destinationConversationId: string, selectedPrincipalIds: readonly string[], now: Date): Promise<readonly string[]>;
	/** Rechecks current destination membership and read access for the fixed audience. */
	requireCurrentAudience(routine: RoutineRow, revision: RoutineRevisionRow, now: Date): Promise<void>;
	/** Rechecks one retired-history reader without depending on other frozen audience members. */
	requireCurrentReader(caller: RoutineCaller, routine: RoutineRow, revision: RoutineRevisionRow, now: Date): Promise<void>;
	/** Returns whether every fixed audience member retains destination and routine read access. */
	currentAudienceAllowed(routine: RoutineRow, revision: RoutineRevisionRow, now: Date): Promise<boolean>;
	/** Loads the current published managed-agent revision. */
	currentManagedAgent(routine: RoutineRow): Promise<CurrentManagedAgent>;
	/** Returns current managed-agent coordinates, or null for a disabled or stale service. */
	findCurrentManagedAgent(routine: RoutineRow): Promise<CurrentManagedAgent | null>;
	/** Loads a current managed agent from explicit trusted coordinates. */
	currentManagedAgentById(siloId: string, serviceId: string): Promise<CurrentManagedAgent>;
	/** Finds a current managed agent from explicit trusted coordinates. */
	findCurrentManagedAgentById(siloId: string, serviceId: string): Promise<CurrentManagedAgent | null>;
	/** Requires one current central decision and optional mutation evidence. */
	requirePrincipalAction(principalId: string, siloId: string, resourceKind: ProductAuthorizationResourceKinds, resourceId: string, action: ProductAuthorizationActions, now: Date, admit: boolean, argumentsValue: JsonValue): Promise<void>;
	/** Returns one current central decision and optional mutation evidence. */
	principalActionAllowed(principalId: string, siloId: string, resourceKind: ProductAuthorizationResourceKinds, resourceId: string, action: ProductAuthorizationActions, now: Date, admit: boolean, argumentsValue: JsonValue): Promise<boolean>;
	/** Atomically records Routine Use and managed AgentService Invoke. */
	admitFiringActions(routine: RoutineRow, actor: RoutineFiringActor, now: Date, argumentsValue: JsonValue): Promise<boolean>;
	/** Finds the unfinished occurrence that blocks automatic overlap. */
	unfinishedFiring(routineId: string): Promise<{ readonly id: string; readonly disposition: RoutineUnfinishedFiringDisposition } | null>;
	/** Maps a stored lifecycle value to the dependency-neutral model. */
	modelStatus(routine: RoutineRow): RoutineStatus;
}
