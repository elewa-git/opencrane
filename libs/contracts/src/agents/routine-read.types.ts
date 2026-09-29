import type { AgentRunTerminalReason, RoutineFiringDisposition, RoutineFiringTrigger, RoutineSchedule, RoutineStatus } from "@opencrane/models/agents";

import type { RoutineFiringReasons } from "./routine-command.types";

/** Ownership label used by an authorized routine list projection. */
export type RoutineOwnership = "owner" | "audience";

/** Safe managed-service label returned by routine read projections. */
export interface RoutineManagedServiceChoice
{
	/** Opaque managed service identifier. */
	readonly managedServiceId: string;
	/** Human-readable service label. */
	readonly displayName: string;
}

/** Safe participant label returned by routine creation options. */
export interface RoutineParticipantChoice
{
	/** Opaque participant reference selected by the caller. */
	readonly participantRef: string;
	/** Human-readable participant label. */
	readonly displayName: string;
	/** Whether this participant is the authenticated caller. */
	readonly isSelf: boolean;
}

/** Compact firing summary included in a routine list item. */
export interface RoutineLastFiringSummary
{
	readonly firingId: string;
	readonly routineRevision: number;
	readonly trigger: RoutineFiringTrigger;
	readonly disposition: RoutineFiringDisposition;
	readonly scheduledSlot: string | null;
	readonly finishedAt: string | null;
}

/** Safe list projection for one authorized routine. */
export interface RoutineListItem
{
	readonly routineId: string;
	readonly currentRevision: number;
	readonly status: RoutineStatus;
	readonly lifecycleRevision: number;
	readonly ownership: RoutineOwnership;
	readonly destinationConversationId: string;
	readonly selectedManagedService: RoutineManagedServiceChoice;
	readonly schedule: RoutineSchedule;
	readonly lastAutomaticOccurrence: string | null;
	readonly nextAutomaticOccurrence: string | null;
	readonly lastFiring: RoutineLastFiringSummary | null;
	readonly capabilities: { readonly revise: boolean; readonly pause: boolean; readonly resume: boolean; readonly retire: boolean; readonly runNow: boolean };
}

/** Cursor-paginated routine list response. */
export interface RoutineListResponse
{
	readonly items: readonly RoutineListItem[];
	readonly limit: number;
	readonly nextCursor?: string;
}

/** Full safe firing history projection for one routine. */
export interface RoutineFiringListItem
{
	readonly firingId: string;
	readonly routineRevision: number;
	readonly trigger: RoutineFiringTrigger;
	readonly disposition: RoutineFiringDisposition;
	readonly scheduledSlot: string | null;
	readonly createdAt: string;
	readonly finishedAt: string | null;
	readonly reason: RoutineFiringReasons | null;
	readonly runTerminalReason: AgentRunTerminalReason | null;
	readonly resultConversationId: string | null;
	readonly actualCost: { readonly amount: string; readonly currency: string } | null;
}

/** Cursor-paginated firing history response. */
export interface RoutineFiringListResponse
{
	readonly items: readonly RoutineFiringListItem[];
	readonly limit: number;
	readonly nextCursor?: string;
}

/** Authorized choices for creating a routine from one destination conversation. */
export interface RoutineCreationOptionsResponse
{
	readonly destinationConversationId: string;
	readonly audienceChoices: readonly RoutineParticipantChoice[];
	readonly managedServiceChoices: readonly RoutineManagedServiceChoice[];
}

/** Strict request for calculating upcoming schedule slots. */
export interface RoutineSchedulePreviewRequest
{
	readonly schedule: RoutineSchedule;
}

/** Five-slot schedule preview response. */
export interface RoutineSchedulePreviewResponse
{
	readonly schedule: RoutineSchedule;
	readonly calculatedAt: string;
	readonly nextOccurrences: readonly [string, string, string, string, string];
}
