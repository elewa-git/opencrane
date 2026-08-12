import type { JsonValue } from "@opencrane/util";

/** How the subject consented to keeping a fact; stored with the fact's metadata. */
export enum MemoryFactConsentStates
{
	/** The subject expressly authorized durable retention of this fact. */
	Explicit = "explicit",
	/** The subject confirmed retention through a reviewed platform flow. */
	Confirmed = "confirmed",
}

/**
 * What one attempt to record a memory fact in Postgres came back with.
 *
 * Recording a fact is two writes that must land together: the metadata row in
 * `memory_fact_catalog`, and the outbox event that later tells Cognee consumers about it.
 * These codes tell a caller which of those happened and what to do next.
 *
 * The three groups oblige different things, and conflating them causes real damage:
 * - `Recorded` and `Idempotent` are both success. `Idempotent` means an earlier attempt with
 *   the same `idempotencyKey` already committed the identical fact, so this attempt wrote
 *   nothing. A caller must treat it as success — retrying it forever, or reporting it as a
 *   failure, would stall a delivery that already went through.
 * - `InvalidCommand`, `DatasetNotFound`, `DatasetRetired` and `CorrectionConflict` are
 *   refusals. The command will never succeed as written, so retrying it is pointless; fix the
 *   command or stop.
 * - `Conflict` means the `idempotencyKey` was already used for a fact with *different*
 *   content. That is a bug in the caller's key generation, not a transient failure. Retrying
 *   cannot fix it, and treating it as `Idempotent` would silently drop the new fact.
 *
 * @see {@link RecordMemoryFactResult} for the shape {@link __RecordMemoryFact} returns.
 */
export enum MemoryCatalogAtomicStatuses
{
	/** Success: a new metadata row and its outbox event committed together. Nothing to retry. */
	Recorded = "recorded",
	/**
	 * Success: an earlier attempt with this `idempotencyKey` already committed the identical
	 * fact, so this attempt wrote nothing. Treat exactly like {@link MemoryCatalogAtomicStatuses.Recorded}.
	 */
	Idempotent = "idempotent",
	/**
	 * Refusal: the command failed the source and field checks in {@link __IsValidMemoryFactCommand}
	 * — a blank required field, a digest that is not a sha256 content address, or a source that is
	 * not exactly one of artifact / message / explicit user statement. Not retryable; fix the command.
	 */
	InvalidCommand = "invalid_command",
	/** Refusal: no dataset has this `datasetId`. Not retryable; the caller resolved the wrong dataset. */
	DatasetNotFound = "dataset_not_found",
	/** Refusal: the dataset exists but is Retired, so it accepts no new facts. Not retryable. */
	DatasetRetired = "dataset_retired",
	/**
	 * Refusal: the fact this correction names in `supersedesFactId` is not an active fact in the
	 * same dataset, so PostgreSQL rejected it and the whole transaction rolled back. Not retryable.
	 */
	CorrectionConflict = "correction_conflict",
	/**
	 * Caller bug: this `idempotencyKey` was already used for a fact with different content.
	 * Never treat this as {@link MemoryCatalogAtomicStatuses.Idempotent} — doing so silently
	 * drops the new fact. Retrying cannot help; the key must be derived from the fact itself.
	 */
	Conflict = "conflict",
}

/** Says where a memory fact came from. Exactly one of these fields identifies the source. */
export interface MemoryFactSource
{
	/** Immutable ArtifactRevision source, when derived from an artifact. */
	readonly artifactRevisionId: string | null;
	/** Immutable Message source, when derived from a conversation. */
	readonly messageId: string | null;
	/** True only when the user stated the fact directly, with no artifact or message source. */
	readonly explicitUserStatement: boolean;
	/** Authenticated user who made the explicit statement, otherwise null. */
	readonly explicitUserId: string | null;
}

/**
 * The metadata to record in Postgres once Cognee has already stored the fact's content.
 *
 * Order matters: Cognee stores the content and returns `cogneeExternalId` first, then this
 * command records the metadata that points at it. Postgres never holds the fact text — only
 * `contentDigest` — so the two stores cannot drift into two different versions of one fact.
 *
 * `source` must name exactly one origin, and `idempotencyKey` must be derived from the fact's
 * own content, because the same key with different content is rejected as
 * {@link MemoryCatalogAtomicStatuses.Conflict}.
 *
 * @see {@link __IsValidMemoryFactCommand} for every rule this shape must satisfy.
 */
export interface RecordMemoryFactCommand
{
	/** OpenCrane dataset catalog identifier. */
	readonly datasetId: string;
	/** Stable external identifier returned by Cognee. */
	readonly cogneeExternalId: string;
	/** Digest of the fact content, so Postgres can identify it without storing it. */
	readonly contentDigest: string;
	/** Consent supporting durable retention. */
	readonly consentState: MemoryFactConsentStates;
	/** User-visible sensitivity classification. */
	readonly sensitivity: string;
	/** Structured provenance kept for explanation and correction. */
	readonly provenance: Readonly<Record<string, JsonValue>>;
	/** Exact source reference. */
	readonly source: MemoryFactSource;
	/** Earlier fact replaced by this correction, or null for a new fact. */
	readonly supersedesFactId: string | null;
	/** Principal recording the catalog entry. */
	readonly recordedBy: string;
	/** Stable idempotency key for catalog and outbox commit. */
	readonly idempotencyKey: string;
}

/** Atomic memory catalog persistence result. */
export type AtomicRecordMemoryFactResult = { readonly status: MemoryCatalogAtomicStatuses.Recorded } | { readonly status: MemoryCatalogAtomicStatuses.Idempotent } | { readonly status: MemoryCatalogAtomicStatuses.InvalidCommand } | { readonly status: MemoryCatalogAtomicStatuses.DatasetNotFound } | { readonly status: MemoryCatalogAtomicStatuses.DatasetRetired } | { readonly status: MemoryCatalogAtomicStatuses.CorrectionConflict } | { readonly status: MemoryCatalogAtomicStatuses.Conflict };

/**
 * Writes one memory fact's catalog row and its outbox event, inside a transaction the caller
 * already opened.
 *
 * Both writes are in the same transaction on purpose: a metadata row with no outbox event
 * would never reach Cognee's consumers, and an outbox event with no row would point at
 * nothing. Implementations must not open their own transaction.
 *
 * Called by: {@link __RecordMemoryFact}, through {@link MemoryCatalogTransaction}.
 *
 * @see {@link PrismaMemoryCatalogRepository} for the only implementation.
 */
export interface MemoryCatalogRepository
{
	/**
	 * Records the fact's metadata and its outbox event together, or neither.
	 *
	 * @param command - The fact to record. Content stays in Cognee; only its digest is stored.
	 * @returns `Recorded` when both rows committed; `Idempotent` when an earlier attempt with
	 * this key already committed the identical fact; `InvalidCommand`, `DatasetNotFound`,
	 * `DatasetRetired` or `Conflict` when the write was refused and nothing was written.
	 */
	recordFactAtomically(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>;
}

/**
 * Explains a unique-constraint failure by reading what is already committed, after the failed
 * write transaction has rolled back.
 *
 * A concurrent attempt can commit the same fact between this caller's check and its insert.
 * Postgres then rejects the insert on a unique index and the whole transaction is gone, so the
 * only way to tell "someone else already recorded exactly this" from "this key was reused for
 * different content" is to read the committed row afterwards. Implementations must only ever
 * be given a client whose failed transaction has already ended.
 *
 * Called by: {@link PrismaMemoryCatalogUnitOfWork} in its post-rollback recovery path.
 *
 * @see {@link PrismaMemoryCatalogCollisionRepository} for the only implementation.
 */
export interface MemoryCatalogCollisionRepository
{
	/**
	 * Reads the committed row for this command's `idempotencyKey` and decides what the collision was.
	 *
	 * @param command - The command whose insert was rejected by a unique index.
	 * @returns `Idempotent` only when the committed row holds the identical fact, so the caller
	 * may report success; `Conflict` for every other collision, including a reused key with
	 * different content and a duplicate dataset/Cognee coordinate under a new key.
	 */
	resolveUniqueCollision(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>;
}

/**
 * The repositories a {@link MemoryCatalogWork} function may use, all bound to one transaction.
 *
 * Handed to the work function by {@link MemoryCatalogUnitOfWork.run}. Nothing here may be kept
 * past the end of that call: the transaction it wraps is closed by then.
 */
export interface MemoryCatalogTransaction
{
	/** Catalog and outbox persistence for this one all-or-nothing delivery. */
	readonly catalog: MemoryCatalogRepository;
}

/**
 * A caller's function that records one fact using the transaction's repositories.
 *
 * Runs inside {@link MemoryCatalogUnitOfWork.run}, and may run more than once: the unit of work
 * retries it after a serialization conflict. It must therefore do no work that cannot be
 * repeated — no external calls, no in-memory state changes the second run would see.
 */
export type MemoryCatalogWork = (transaction: MemoryCatalogTransaction) => Promise<AtomicRecordMemoryFactResult>;

/**
 * Opens the transaction in which a fact's catalog row and its outbox event are written together.
 *
 * Owns three things the work function must not attempt itself: Serializable isolation, a
 * bounded retry after a conflict rolls the transaction back, and reading committed state after
 * a unique-constraint failure to decide whether the write was a repeat or a real conflict.
 *
 * Called by: {@link __RecordMemoryFact}.
 *
 * @see {@link PrismaMemoryCatalogUnitOfWork} for the only implementation.
 */
export interface MemoryCatalogUnitOfWork
{
	/**
	 * Runs the work in one Serializable transaction, retrying it when a conflict rolls it back.
	 *
	 * @param command - The fact being recorded, needed to resolve a post-rollback collision.
	 * @param work - The function to run; may be called more than once. See {@link MemoryCatalogWork}.
	 * @returns Whatever the work returned, or the collision verdict when a unique constraint
	 * rejected the insert and the committed row had to be read instead.
	 * @throws __MemoryCatalogCorrectionConflictError when PostgreSQL rejected the correction
	 * because the fact it replaces is no longer active. The transaction has already rolled back.
	 * @throws Error on any unexpected failure, and on a conflict still unresolved after the last
	 * attempt, so the caller fails closed rather than reporting a write that did not happen.
	 */
	run(command: RecordMemoryFactCommand, work: MemoryCatalogWork): Promise<AtomicRecordMemoryFactResult>;
}

/** Stable outcome of recording memory catalog metadata. */
export type RecordMemoryFactResult =
	| { readonly outcome: "recorded"; readonly idempotent: boolean }
	| { readonly outcome: "denied"; readonly reason: MemoryCatalogAtomicStatuses.InvalidCommand | MemoryCatalogAtomicStatuses.DatasetNotFound | MemoryCatalogAtomicStatuses.DatasetRetired | MemoryCatalogAtomicStatuses.CorrectionConflict | MemoryCatalogAtomicStatuses.Conflict };
