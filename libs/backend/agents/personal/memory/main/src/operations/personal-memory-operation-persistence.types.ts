import type { PersonalMemoryOperationEvent, PersonalMemoryOperationKinds, PersonalMemoryOperationLifecycle, PersonalMemoryOperationTransitionDenialReasons } from "./personal-memory-operation.types";

/** Records the encrypted conversation entry admitted as the source of Remember or Correct. */
export interface PersonalMemoryOperationMessageSource
{
	/** Conversation stream that owns the immutable message entry. */
	readonly conversationId: string;
	/** Message identifier within the conversation stream. */
	readonly messageId: string;
	/** Immutable zero-based message position in the conversation stream. */
	readonly messagePosition: bigint;
	/** Opaque reference used to reread the encrypted private payload. */
	readonly payloadRef: string;
	/** SHA-256 digest of the ciphertext saved at admission. */
	readonly ciphertextDigest: string;
	/** Principal that authored the admitted human message. */
	readonly authorPrincipalId: string;
}

/** Reserves the workflow identity that a later product admission must create atomically. */
export interface PersonalMemoryOperationTaskIdentity
{
	/** UUID chosen before admission; its presence does not prove a workflow task exists. */
	readonly taskId: string;
	/** Workflow definition name the later composition root must admit. */
	readonly taskName: string;
	/** Idempotency key passed to that workflow definition. */
	readonly taskKey: string;
}

/** Complete secret-free command evidence needed to save one personal-memory operation. */
export interface AdmitPersonalMemoryOperationCommand
{
	/** UUID saved before any provider or workflow action. */
	readonly operationId: string;
	/** Organisation boundary derived from the trusted request host. */
	readonly siloId: string;
	/** Local personal dataset row selected under current authority. */
	readonly datasetId: string;
	/** Authenticated principal that issued the command. */
	readonly actorPrincipalId: string;
	/** SHA-256 digest of the caller's idempotency key. */
	readonly idempotencyKeyDigest: string;
	/** SHA-256 digest binding every immutable field in this admitted command. */
	readonly commandDigest: string;
	/** User command kept separate from the lifecycle phase. */
	readonly kind: PersonalMemoryOperationKinds;
	/** Encrypted message coordinates for Remember and Correct; Forget has no new source. */
	readonly source: PersonalMemoryOperationMessageSource | null;
	/** Complete UTF-8 content digest for Remember and Correct; Forget stores none. */
	readonly contentDigest: string | null;
	/** Existing catalog fact selected by Correct or Forget. */
	readonly targetFactId: string | null;
	/** Existing provider document selected by Correct or Forget. */
	readonly targetDocumentId: string | null;
	/** Positive catalog revision checked by the later admission owner. */
	readonly expectedFactRevision: number | null;
	/** Provider dataset already adopted by Correct or Forget; Remember may still ensure it. */
	readonly providerDatasetId: string | null;
	/** Workflow identity reserved with this row but not asserted to exist. */
	readonly task: PersonalMemoryOperationTaskIdentity;
	/** Time the authenticated command was admitted. */
	readonly admittedAt: Date;
}

/** Durable personal-memory operation, containing coordinates and digests but no remembered text. */
export interface PersonalMemoryOperationRecord extends PersonalMemoryOperationLifecycle
{
	/** Organisation boundary retained with the operation. */
	readonly siloId: string;
	/** Local personal dataset row whose lock precedes every operation lock. */
	readonly datasetId: string;
	/** Authenticated principal that issued the original command. */
	readonly actorPrincipalId: string;
	/** SHA-256 digest used to find exact command replays. */
	readonly idempotencyKeyDigest: string;
	/** SHA-256 digest binding all admitted command coordinates. */
	readonly commandDigest: string;
	/** Encrypted source coordinates retained for Remember and Correct. */
	readonly source: PersonalMemoryOperationMessageSource | null;
	/** Expected target catalog revision for Correct and Forget. */
	readonly expectedFactRevision: number | null;
	/** Provider dataset coordinate admitted with the command before later lifecycle adoption. */
	readonly admittedProviderDatasetId: string | null;
	/** Workflow identity reserved at admission without claiming the task exists. */
	readonly task: PersonalMemoryOperationTaskIdentity;
	/** Time the command row was first admitted. */
	readonly admittedAt: Date;
	/** Time the current recovery evidence was recorded, or null outside recovery. */
	readonly recoveryRecordedAt: Date | null;
	/** Time the lifecycle first reached Completed. */
	readonly completedAt: Date | null;
}

/** States whether admission inserted a new operation or returned an exact replay. */
export enum PersonalMemoryOperationAdmissionOutcomes
{
	/** This transaction inserted the operation and its reserved task identity. */
	Created = "created",
	/** The same command was already admitted, so the existing operation is returned. */
	Replayed = "replayed",
}

/** Result of creating or replaying an operation under its dataset and fact locks. */
export interface PersonalMemoryOperationAdmissionResult
{
	/** Whether this call inserted the row or found the exact existing command. */
	readonly outcome: PersonalMemoryOperationAdmissionOutcomes;
	/** Validated durable operation that owns all later lifecycle events. */
	readonly operation: PersonalMemoryOperationRecord;
}

/** States how persistence handled one lifecycle event after validating the saved row. */
export enum PersonalMemoryOperationPersistenceOutcomes
{
	/** The accepted event won its revision compare-and-set. */
	Advanced = "advanced",
	/** The planner proved no bytes were sent and left the operation unchanged for retry. */
	Retry = "retry",
	/** The planner rejected the event before persistence changed the row. */
	Denied = "denied",
	/** Another writer changed the row first; this result returns that validated durable state. */
	ConcurrentWinner = "concurrent_winner",
}

/** Persistence result for one event, including a concurrent row that won the same revision. */
export interface PersonalMemoryOperationPersistenceResult
{
	/** How the repository handled the event. */
	readonly outcome: PersonalMemoryOperationPersistenceOutcomes;
	/** Validated saved state after this call, including a concurrent winner. */
	readonly operation: PersonalMemoryOperationRecord;
	/** Planner denial reason, present only when the event was rejected. */
	readonly reason?: PersonalMemoryOperationTransitionDenialReasons;
}

/** Transaction-scoped port for operation admission and lifecycle compare-and-set updates. */
export interface PersonalMemoryOperationRepository
{
	/**
	 * Inserts one operation or returns its exact replay under the documented lock order.
	 * @param command - Secret-free command evidence and reserved workflow identity.
	 * @returns The validated created operation or existing exact replay.
	 * @throws {@link PersonalMemoryOperationReplayConflict} when the replay key names different evidence.
	 * @throws {@link PersonalMemoryOperationInvalidState} when input or a saved row is invalid.
	 */
	admit(command: AdmitPersonalMemoryOperationCommand): Promise<PersonalMemoryOperationAdmissionResult>;
	/**
	 * Plans and saves one event through the reviewed lifecycle policy.
	 * @param event - Event bound to the operation UUID, kind, and expected revision.
	 * @param recordedAt - Database-boundary time used for recovery and completion timestamps.
	 * @returns The accepted result, denial, retry, or validated concurrent winner.
	 * @throws {@link PersonalMemoryOperationInvalidState} when the saved row is missing or invalid.
	 */
	apply(event: PersonalMemoryOperationEvent, recordedAt: Date): Promise<PersonalMemoryOperationPersistenceResult>;
}

/** Opens serializable operation transactions and binds each repository to the callback client. */
export interface PersonalMemoryOperationUnitOfWork
{
	/** Admits one operation in a fresh serializable transaction. */
	admit(command: AdmitPersonalMemoryOperationCommand): Promise<PersonalMemoryOperationAdmissionResult>;
	/** Applies one lifecycle event in a fresh serializable transaction. */
	apply(event: PersonalMemoryOperationEvent, recordedAt: Date): Promise<PersonalMemoryOperationPersistenceResult>;
}

/** Reports that an idempotency key already belongs to different immutable command evidence. */
export class PersonalMemoryOperationReplayConflict extends Error
{
	/** Creates the stable domain error without echoing conflicting evidence. */
	constructor()
	{
		super("personal-memory operation replay conflicts with the admitted command");
		this.name = "PersonalMemoryOperationReplayConflict";
	}
}

/** Reports invalid command input, a missing authority row, or impossible saved operation state. */
export class PersonalMemoryOperationInvalidState extends Error
{
	/** Creates a domain error whose message never includes source coordinates or provider payloads. */
	constructor(message: string)
	{
		super(message);
		this.name = "PersonalMemoryOperationInvalidState";
	}
}
