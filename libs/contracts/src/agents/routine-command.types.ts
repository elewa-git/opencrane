import type { RoutineFiringDisposition, RoutineFiringTrigger, RoutineSchedule, RoutineStatus } from "@opencrane/models/agents";

import type { RoutineListItem, RoutineParticipantChoice } from "./routine-read.types";

/** Public reasons that a routine firing can finish before execution starts; values are durable API client strings. */
export enum RoutineFiringReasons
{
	/** The routine was retired before the manual firing could start. */
	RoutineRetired = "routine_retired",
	/** Current authority or audience checks refused the firing. */
	CurrentAuthorityOrAudienceRefused = "current_authority_or_audience_refused",
	/** An automatic slot was consumed because another firing was unfinished. */
	UnfinishedFiring = "unfinished_firing",
}

/** Browser request for creating one reviewed routine. */
export interface RoutineCreateRequest
{
	/** Existing conversation whose reviewed audience will be retained. */
	readonly destinationConversationId: string;
	/** Exact reviewed audience participant references selected by the caller. */
	readonly audienceParticipantRefs: readonly string[];
	/** Managed assistant service used by future firings. */
	readonly selectedManagedServiceId: string;
	/** Five-field schedule and named timezone. */
	readonly schedule: RoutineSchedule;
	/** Plaintext instruction that the server encrypts before persistence. */
	readonly instruction: string;
	/** Caller-owned retry key for recovering an uncertain response. */
	readonly idempotencyKey: string;
	/** Opaque routine proposal reference when this creation accepts a reviewed suggestion. */
	readonly proposalRef?: string;
}

/** Browser request for replacing one routine's schedule and instruction. */
export interface RoutineReviseRequest
{
	/** Current immutable revision reviewed by the caller. */
	readonly expectedRevision: number;
	/** Current lifecycle revision reviewed by the caller. */
	readonly expectedLifecycleRevision: number;
	/** Replacement five-field schedule and named timezone. */
	readonly schedule: RoutineSchedule;
	/** Replacement plaintext instruction encrypted by the server. */
	readonly instruction: string;
	/** Caller-owned retry key for recovering an uncertain response. */
	readonly idempotencyKey: string;
}

/** Browser request shared by pause, resume, retire and manual fire commands. */
export interface RoutineControlRequest
{
	/** Current lifecycle revision reviewed by the caller. */
	readonly expectedLifecycleRevision: number;
	/** Caller-owned retry key for recovering an uncertain response. */
	readonly idempotencyKey: string;
}

/** Safe routine definition returned after a definition or lifecycle command. */
export interface RoutineDefinitionResponse
{
	/** Stable routine identifier. */
	readonly routineId: string;
	/** Current immutable instruction and schedule revision. */
	readonly currentRevision: number;
	/** Current automatic lifecycle status. */
	readonly status: RoutineStatus;
	/** Compare-and-set revision for lifecycle commands. */
	readonly lifecycleRevision: number;
	/** Next automatic slot, or null while automatic firing is disabled. */
	readonly nextAutomaticOccurrence: string | null;
}

/** Safe routine details returned after an authorized read. */
export interface RoutineDetailsResponse extends RoutineListItem
{
	/** Fixed reviewed audience references and safe labels. */
	readonly audienceParticipantRefs: readonly string[];
	readonly audienceChoices: readonly RoutineParticipantChoice[];
	/** Decrypted current instruction for the authorized audience. */
	readonly instruction: string;
	/** Commands currently permitted by ownership and lifecycle state. */
	readonly capabilities: { readonly revise: boolean; readonly pause: boolean; readonly resume: boolean; readonly retire: boolean; readonly runNow: boolean };
}

/** Safe result returned after a manual firing command. */
export interface RoutineFiringResponse
{
	/** Stable firing identifier. */
	readonly firingId: string;
	/** Stable routine identifier. */
	readonly routineId: string;
	/** Immutable routine revision selected for this firing. */
	readonly routineRevision: number;
	/** Whether a schedule or manual command selected this firing. */
	readonly trigger: RoutineFiringTrigger;
	/** Current saved firing disposition. */
	readonly disposition: RoutineFiringDisposition;
	/** Automatic slot, or null for a manual firing. */
	readonly scheduledSlot: string | null;
	/** Public refusal or overlap reason, or null for other dispositions. */
	readonly reason: RoutineFiringReasons | null;
}
