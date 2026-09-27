import type { RoutineFiringDisposition, RoutineFiringTrigger, RoutineSchedule, RoutineStatus } from "@opencrane/models/agents";

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
	/** Exact Principal identifiers selected by the caller from the reviewed audience. */
	readonly audiencePrincipalIds: readonly string[];
	/** Managed assistant service used by future firings. */
	readonly selectedManagedServiceId: string;
	/** Five-field schedule and named timezone. */
	readonly schedule: RoutineSchedule;
	/** Plaintext instruction that the server encrypts before persistence. */
	readonly instruction: string;
	/** Caller-owned retry key for recovering an uncertain response. */
	readonly idempotencyKey: string;
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
export interface RoutineDetailsResponse extends RoutineDefinitionResponse
{
	/** Conversation whose reviewed audience was fixed at creation. */
	readonly destinationConversationId: string;
	/** Managed assistant service used by future firings. */
	readonly selectedManagedServiceId: string;
	/** Current normalized schedule. */
	readonly schedule: RoutineSchedule;
	/** Fixed reviewed audience, sorted by the server. */
	readonly audiencePrincipalIds: readonly string[];
	/** Decrypted current instruction for the authorized audience. */
	readonly instruction: string;
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
	/** Independent conversation reserved for this firing. */
	readonly conversationId: string;
	/** Automatic slot, or null for a manual firing. */
	readonly scheduledSlot: string | null;
	/** Public refusal or overlap reason, or null for other dispositions. */
	readonly reason: RoutineFiringReasons | null;
}
