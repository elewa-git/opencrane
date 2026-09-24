import type { MemoryMutationDeliveryStates } from "@opencrane/contracts";

/**
 * Selects the independent personal-memory command whose durable lifecycle is being planned.
 *
 * This value will be stored with the operation. Renaming a member requires a fresh-baseline schema
 * change. Command strategy stays separate from lifecycle phase so a phase never implies user intent.
 */
export enum PersonalMemoryOperationKinds
{
	/** Adds a new fact from an authorized source and makes it recallable after indexing. */
	Remember = "remember",
	/** Adds and indexes a replacement before retiring the prior fact and provider document. */
	Correct = "correct",
	/** Hides a fact immediately, deletes its provider document, and then finalizes forgetting. */
	Forget = "forget",
}

/**
 * Names the saved phase of one personal-memory operation.
 *
 * These values will be stored in PostgreSQL. Renaming one requires a fresh-baseline schema change.
 * Only `Completed` is terminal. `RecoveryRequired` preserves the phase that needs reconciliation.
 */
export enum PersonalMemoryOperationPhases
{
	/** A Remember operation is waiting to ensure and adopt its personal provider dataset. */
	DatasetEnsurePending = "dataset_ensure_pending",
	/** Remember or Correct is waiting to add or reconcile its digest-bound document. */
	DocumentAddPending = "document_add_pending",
	/** The document is saved; input evidence and an exact completed Cognify receipt are still owed. */
	CognifyPending = "cognify_pending",
	/** Exact indexing completion is saved and the Active catalog mutation is pending. */
	CatalogCommitPending = "catalog_commit_pending",
	/** A correction is recallable and the prior provider document still needs exact deletion. */
	PriorDocumentDeletePending = "prior_document_delete_pending",
	/** A Forget operation has hidden its fact and is waiting for exact document absence. */
	DocumentDeletePending = "document_delete_pending",
	/** Exact provider absence is saved and the Forgotten catalog transition is pending. */
	CatalogFinalizePending = "catalog_finalize_pending",
	/** An uncertain or blocked step needs evidence before the saved phase can advance. */
	RecoveryRequired = "recovery_required",
	/** Every required provider and catalog effect for this command has completed. */
	Completed = "completed",
}

/**
 * Names events accepted by the personal-memory lifecycle planner.
 *
 * Events are internal planning inputs and are not stored or sent across an API. Each success event
 * means the caller already verified the evidence named by that event.
 */
export enum PersonalMemoryOperationEvents
{
	/** The opaque personal dataset name resolved to one ACL-complete provider dataset UUID. */
	DatasetEnsured = "dataset_ensured",
	/** Add or read-only reconciliation proved one document with the saved content digest. */
	DocumentAdded = "document_added",
	/** A document-list receipt supplied the complete expected Cognify input digest. */
	IndexEvidenceSaved = "index_evidence_saved",
	/** The exact saved operation and input digest produced one completed pipeline-run receipt. */
	IndexingCompleted = "indexing_completed",
	/** The new Active catalog fact committed with the saved provider evidence. */
	CatalogCommitted = "catalog_committed",
	/** Exact absence of a corrected fact's prior provider document was proved. */
	PriorDocumentDeleted = "prior_document_deleted",
	/** Exact absence of the Forget target's provider document was proved. */
	DocumentDeleted = "document_deleted",
	/** The hidden fact advanced to Forgotten after exact provider absence was saved. */
	CatalogFinalized = "catalog_finalized",
	/** A provider mutation failed with evidence about whether bytes could have been delivered. */
	MutationFailed = "mutation_failed",
	/** A non-mutation guard or read cannot currently prove that the operation may advance. */
	OperationBlocked = "operation_blocked",
}

/**
 * Fixed failure evidence saved with an operation that needs recovery.
 *
 * These values will be stored and may be projected to product callers. Renaming one is a breaking
 * persistence and API change. They contain no provider response, source text, or credential detail.
 */
export enum PersonalMemoryOperationFailureCodes
{
	/** Current product authorization or source ownership no longer permits the command. */
	AuthorityEnded = "authority_ended",
	/** The personal dataset cannot be safely ensured, adopted, or used. */
	DatasetUnavailable = "dataset_unavailable",
	/** The encrypted source cannot be re-read with its admitted coordinates and digest. */
	SourceUnavailable = "source_unavailable",
	/** Add reconciliation found no unique document matching the saved content digest. */
	DocumentConflict = "document_conflict",
	/** Current dataset input no longer matches the evidence saved before Cognify dispatch. */
	IndexInputChanged = "index_input_changed",
	/** Exact indexing completion cannot be established without repeating uncertain work. */
	IndexingUnavailable = "indexing_unavailable",
	/** The fact catalog winner conflicts with the operation's saved revision or coordinates. */
	CatalogConflict = "catalog_conflict",
	/** Exact provider document absence cannot currently be proved. */
	DeletionUnavailable = "deletion_unavailable",
}

/** Why the lifecycle planner accepted or rejected one event. */
export enum PersonalMemoryOperationTransitionOutcomes
{
	/** The event advances the saved operation to a new phase and revision. */
	Advanced = "advanced",
	/** The provider proved no mutation bytes were sent, so the same saved command may retry. */
	Retry = "retry",
	/** The event is stale, malformed, conflicts with saved evidence, or is invalid in this phase. */
	Denied = "denied",
}

/** Fixed reason for rejecting an event without applying an effect. */
export enum PersonalMemoryOperationTransitionDenialReasons
{
	/** The saved operation or event fails its model-adjacent validator. */
	InvalidInput = "invalid_input",
	/** The event names another operation or command strategy. */
	WrongOperation = "wrong_operation",
	/** The event expected a different saved revision. */
	StaleRevision = "stale_revision",
	/** This command strategy cannot accept the event in its current or recovery phase. */
	InvalidTransition = "invalid_transition",
	/** The event's provider coordinates or digests disagree with saved evidence. */
	ConflictingEvidence = "conflicting_evidence",
}

/** Immutable evidence required when a personal-memory operation is first admitted. */
export interface CreatePersonalMemoryOperationLifecycleCommand
{
	/** UUID saved before any workflow or provider action and repeated on every event. */
	readonly operationId: string;
	/** Independent command strategy selected by the authenticated product route. */
	readonly kind: PersonalMemoryOperationKinds;
	/** Complete source UTF-8 digest for Remember or Correct; Forget has no new content. */
	readonly expectedContentDigest: string | null;
	/** Existing local fact coordinate for Correct or Forget; Remember has no target. */
	readonly targetFactId: string | null;
	/** Existing provider document coordinate for Correct or Forget; Remember has no target. */
	readonly targetDocumentId: string | null;
	/** Already active provider dataset for Correct or Forget; first Remember may still provision it. */
	readonly providerDatasetId: string | null;
}

/** Durable lifecycle projection that contains provider coordinates and hashes but never fact text. */
export interface PersonalMemoryOperationLifecycle
{
	/** Stable UUID that fences every transition and later supplies the Cognify operation identity. */
	readonly operationId: string;
	/** User-command strategy, kept separate from lifecycle phase. */
	readonly kind: PersonalMemoryOperationKinds;
	/** Current saved lifecycle phase. */
	readonly phase: PersonalMemoryOperationPhases;
	/** Positive compare-and-set revision expected by the next event. */
	readonly revision: number;
	/** Phase whose evidence is unresolved while `phase` is `RecoveryRequired`. */
	readonly recoveryPhase: PersonalMemoryOperationPhases | null;
	/** Complete source digest admitted for Remember or Correct. */
	readonly expectedContentDigest: string | null;
	/** Existing fact replaced or forgotten by Correct or Forget. */
	readonly targetFactId: string | null;
	/** Existing provider document replaced or forgotten by Correct or Forget. */
	readonly targetDocumentId: string | null;
	/** Provider dataset adopted from ensure or required at Correct and Forget admission. */
	readonly providerDatasetId: string | null;
	/** New provider document adopted after Add or read-only reconciliation. */
	readonly documentId: string | null;
	/** Caller-saved UUID for the exact Cognify admission. */
	readonly indexingOperationId: string | null;
	/** Complete dataset input digest saved before the first Cognify dispatch. */
	readonly expectedInputEvidenceDigest: string | null;
	/** Provider pipeline run bound to the saved indexing operation and input digest. */
	readonly pipelineRunId: string | null;
	/** Fixed recovery reason with no source or provider data. */
	readonly failureCode: PersonalMemoryOperationFailureCodes | null;
	/** Mutation-delivery evidence; null for non-mutation recovery and ordinary phases. */
	readonly deliveryState: MemoryMutationDeliveryStates | null;
}

interface PersonalMemoryOperationEventBase
{
	/** Operation UUID the caller read before producing the event. */
	readonly operationId: string;
	/** Command strategy the caller expects the saved operation to retain. */
	readonly kind: PersonalMemoryOperationKinds;
	/** Saved revision this event is allowed to advance. */
	readonly expectedRevision: number;
}

/** One strictly shaped event accepted by the lifecycle planner. */
export type PersonalMemoryOperationEvent =
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.DatasetEnsured; readonly providerDatasetId: string }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.DocumentAdded; readonly documentId: string; readonly contentDigest: string }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.IndexEvidenceSaved; readonly indexingOperationId: string; readonly expectedInputEvidenceDigest: string }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.IndexingCompleted; readonly indexingOperationId: string; readonly expectedInputEvidenceDigest: string; readonly pipelineRunId: string }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.CatalogCommitted }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.PriorDocumentDeleted; readonly documentId: string }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.DocumentDeleted; readonly documentId: string }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.CatalogFinalized }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.MutationFailed; readonly failureCode: PersonalMemoryOperationFailureCodes; readonly deliveryState: MemoryMutationDeliveryStates }
	| PersonalMemoryOperationEventBase & { readonly event: PersonalMemoryOperationEvents.OperationBlocked; readonly failureCode: PersonalMemoryOperationFailureCodes };

/** Flat result whose next state is present only when the planner accepts the event. */
export interface PersonalMemoryOperationTransitionResult
{
	/** States whether the caller must persist an advance, retry unchanged, or stop. */
	readonly outcome: PersonalMemoryOperationTransitionOutcomes;
	/** Next state for an advance, or the unchanged state for a proven-not-sent retry. */
	readonly operation?: PersonalMemoryOperationLifecycle;
	/** Fixed denial reason populated only when `outcome` is `Denied`. */
	readonly reason?: PersonalMemoryOperationTransitionDenialReasons;
}
