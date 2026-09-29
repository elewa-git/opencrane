import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";
import type { AuthorizationAuthority, ManagedAuthorizationGrantRepository, ManagedAuthorizationGrantRestrictionRepository } from "@opencrane/backend/server/iam/authorization";
import type { RoutineFiringDisposition, RoutineFiringTrigger, RoutineSchedule, RoutineStatus } from "@opencrane/models/agents";
import type { RoutineCreationOptionsResponse, RoutineFiringListResponse, RoutineListItem, RoutineListResponse, RoutineManagedServiceChoice, RoutineParticipantChoice, RoutineSchedulePreviewResponse } from "@opencrane/contracts";

import type { RoutineInstructionEnvelope } from "./routine-instruction.types";

/** Authenticated human coordinates resolved outside request payloads. */
export interface RoutineCaller
{
	/** Organisation derived from the trusted host and current membership. */
	readonly siloId: string;
	/** Durable local Principal that issued the command. */
	readonly principalId: string;
	/** Verified OpenID Connect issuer retained as creation evidence. */
	readonly issuer: string;
	/** Verified OpenID Connect subject used by conversation participation. */
	readonly subjectId: string;
	/** Original session authentication instant, never refreshed by an automatic firing. */
	readonly authenticatedAt: string;
}

/** Produces opaque product identifiers before a retryable transaction starts. */
export interface RoutineIdFactory
{
	/** Allocates a stable routine aggregate identifier. */
	routineId(): string;
	/** Allocates an immutable routine revision identifier. */
	revisionId(): string;
	/** Allocates an immutable occurrence identifier. */
	firingId(): string;
	/** Allocates the future occurrence conversation before asynchronous preparation. */
	conversationId(): string;
	/** Allocates an idempotent requester command receipt. */
	commandReceiptId(): string;
}

/** User command that creates a routine from an existing readable conversation. */
export interface CreateRoutineCommand
{
	/** Authenticated creator; browser input must not supply these coordinates. */
	readonly caller: RoutineCaller;
	/** Existing conversation whose current participants become the fixed explicit audience. */
	readonly destinationConversationId: string;
	/** Exact opaque organisation membership references selected from reviewed current participants. */
	readonly audienceParticipantRefs: readonly string[];
	/** Active managed agent service selected for every future occurrence. */
	readonly selectedManagedServiceId: string;
	/** Normalized five-field cron and named timezone. */
	readonly schedule: RoutineSchedule;
	/** Plaintext instruction encrypted before persistence begins. */
	readonly instruction: string;
	/** Caller key that recovers the first committed result. */
	readonly idempotencyKey: string;
	/** Opaque proposal accepted by this reviewed create command, when present. */
	readonly proposalRef?: string;
}

/** Requester command that replaces only instruction and schedule with a new revision. */
export interface ReviseRoutineCommand
{
	/** Authenticated original requester. */
	readonly caller: RoutineCaller;
	/** Stable routine to revise. */
	readonly routineId: string;
	/** Current revision the requester reviewed before editing. */
	readonly expectedRevision: number;
	/** Current lifecycle counter the requester reviewed before editing. */
	readonly expectedLifecycleRevision: number;
	/** Replacement schedule that starts at commit time without catch-up. */
	readonly schedule: RoutineSchedule;
	/** Replacement plaintext encrypted before persistence begins. */
	readonly instruction: string;
	/** Caller key that recovers the first committed result. */
	readonly idempotencyKey: string;
}

/** Requester lifecycle command shared by pause, resume, and retire. */
export interface ChangeRoutineStatusCommand
{
	/** Authenticated original requester. */
	readonly caller: RoutineCaller;
	/** Stable routine whose lifecycle changes. */
	readonly routineId: string;
	/** Current lifecycle counter the requester reviewed. */
	readonly expectedLifecycleRevision: number;
	/** Caller key that recovers the first committed result. */
	readonly idempotencyKey: string;
}

/** Requester command that creates one immediate occurrence without changing the schedule cursor. */
export interface RunRoutineNowCommand
{
	/** Authenticated original requester. */
	readonly caller: RoutineCaller;
	/** Stable routine to fire. */
	readonly routineId: string;
	/** Current lifecycle counter the requester reviewed. */
	readonly expectedLifecycleRevision: number;
	/** Caller key that identifies this immediate occurrence. */
	readonly idempotencyKey: string;
}

/** Authorized routine read request. */
export interface ReadRoutineCommand
{
	/** Authenticated audience member. */
	readonly caller: RoutineCaller;
	/** Stable routine to read. */
	readonly routineId: string;
}

/** Cursor-paginated routine list command. */
export interface ListRoutinesCommand
{
	/** Authenticated audience member. */
	readonly caller: RoutineCaller;
	/** Bounded candidate window requested by the browser. */
	readonly limit: number;
	/** Opaque encrypted continuation token. */
	readonly cursor?: string;
}

/** Cursor-paginated firing-history command. */
export interface ListRoutineFiringsCommand extends ListRoutinesCommand
{
	/** Routine authorized before any firing row is returned. */
	readonly routineId: string;
}

/** Destination-scoped creation-options command. */
export interface RoutineCreationOptionsCommand
{
	/** Authenticated requester reviewing creation choices. */
	readonly caller: RoutineCaller;
	/** Existing destination conversation. */
	readonly destinationConversationId: string;
}

/** Schedule-only preview command using the authenticated silo clock. */
export interface RoutineSchedulePreviewCommand
{
	/** Authenticated requester selecting the silo clock. */
	readonly caller: RoutineCaller;
	/** Normalized five-field schedule and named timezone. */
	readonly schedule: RoutineSchedule;
}

/** Stable outcomes returned by routine mutations and command replay. */
export enum RoutineCommandOutcome
{
	/** A new aggregate, revision, or lifecycle transition committed. */
	Committed = "committed",
	/** Lifecycle or current authority refused a saved manual occurrence. */
	Refused = "refused",
}

/** Projection returned after a routine definition command commits. */
export interface RoutineCommandResult
{
	/** First committed outcome; an exact retry returns this value unchanged. */
	readonly outcome: RoutineCommandOutcome;
	/** Stable routine aggregate identifier. */
	readonly routineId: string;
	/** Current immutable revision. */
	readonly currentRevision: number;
	/** Current routine lifecycle. */
	readonly status: RoutineStatus;
	/** Counter used by requester compare-and-set commands. */
	readonly lifecycleRevision: number;
	/** Next automatic UTC slot, or null while automatic firing is disabled. */
	readonly nextAutomaticOccurrence: string | null;
}

/** Projection returned for one saved automatic or manual occurrence. */
export interface RoutineFiringResult
{
	/** Says whether the command wrote, recovered, or refused the occurrence. */
	readonly outcome: RoutineCommandOutcome;
	/** Immutable occurrence identifier. */
	readonly firingId: string;
	/** Stable routine aggregate identifier. */
	readonly routineId: string;
	/** Immutable routine revision selected for this occurrence. */
	readonly routineRevision: number;
	/** Why the occurrence was considered. */
	readonly trigger: RoutineFiringTrigger;
	/** Current durable occurrence state. */
	readonly disposition: RoutineFiringDisposition;
	/** Reserved independent occurrence conversation. */
	readonly conversationId: string;
	/** Automatic UTC slot, or null for an immediate command. */
	readonly scheduledSlot: string | null;
	/** Refusal or overlap reason stored with a terminal result. */
	readonly reason: string | null;
}

/** Authorized projection whose encrypted instruction is decrypted after commit. */
export interface EncryptedRoutineProjection extends RoutineListItem
{
	/** Conversation from which the routine and fixed audience were created. */
	readonly destinationConversationId: string;
	/** Managed service checked again before every occurrence. */
	readonly selectedManagedServiceId: string;
	/** Safe current label for the selected managed service. */
	readonly selectedManagedService: RoutineManagedServiceChoice;
	/** Says whether the caller is the immutable requester or another audience reader. */
	readonly ownership: "owner" | "audience";
	/** Original approved requester Principal. */
	readonly requesterPrincipalId: string;
	/** Original verified issuer retained for run provenance. */
	readonly requesterIssuer: string;
	/** Original verified subject retained for run provenance. */
	readonly requesterSubjectId: string;
	/** Original authentication instant retained for run provenance. */
	readonly requesterAuthenticatedAt: string;
	/** Current normalized schedule. */
	readonly schedule: RoutineSchedule;
	/** Fixed creator-confirmed audience mapped back to opaque membership references. */
	readonly audienceParticipantRefs: readonly string[];
	/** Safe current labels for fixed audience references. */
	readonly audienceChoices: readonly RoutineParticipantChoice[];
	/** Current command hints derived from policy without recording an effect admission. */
	readonly capabilities: { readonly revise: boolean; readonly pause: boolean; readonly resume: boolean; readonly retire: boolean; readonly runNow: boolean };
	/** Encrypted current instruction. */
	readonly instruction: RoutineInstructionEnvelope;
}

/** Authorized projection returned to a caller after decryption. */
export interface RoutineProjection extends Omit<EncryptedRoutineProjection, "instruction">
{
	/** Decrypted instruction returned only after current read authorization. */
	readonly instruction: string;
}

/** Transaction-bound factory for the central product authorization authority. */
export type RoutineAuthorizationFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/** Transaction-bound factory for grants derived from the creator-confirmed fixed audience. */
export type RoutineManagedGrantRepositoryFactory<Transaction> = (transaction: Transaction) => ManagedAuthorizationGrantRepository & ManagedAuthorizationGrantRestrictionRepository;

/** Public read results returned by the routine authority. */
export type RoutineListResult = RoutineListResponse;
/** Public firing-history results returned by the routine authority. */
export type RoutineFiringListResult = RoutineFiringListResponse;
/** Public destination-scoped creation choices returned by the routine authority. */
export type RoutineCreationOptionsResult = RoutineCreationOptionsResponse;
/** Public five-slot schedule preview returned by the routine authority. */
export type RoutineSchedulePreviewResult = RoutineSchedulePreviewResponse;

/** Input used by the automatic wake task under its saved receipt fence. */
export interface AutomaticRoutineFiringCommand
{
	/** Organisation that owns the routine and task. */
	readonly siloId: string;
	/** Stable routine selected by the task. */
	readonly routineId: string;
	/** Revision whose schedule task was admitted. */
	readonly routineRevision: number;
	/** Exact workflow receipt saved on the routine. */
	readonly scheduleTask: IWorkflowTaskReceipt;
	/** Preallocated occurrence identifier retained across transaction retries. */
	readonly firingId: string;
	/** Preallocated independent conversation identifier retained across retries. */
	readonly conversationId: string;
}
