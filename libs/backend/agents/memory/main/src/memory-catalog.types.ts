import type { JsonValue } from "@opencrane/util";

/** Retention evidence accepted by the durable catalog and persisted with its fact metadata. */
export enum MemoryFactConsentStates
{
	/** The subject expressly authorized durable retention of this fact. */
	Explicit = "explicit",
	/** The subject confirmed retention through a reviewed platform flow. */
	Confirmed = "confirmed",
}

/** Stable catalog-write outcomes exposed to a caller after one atomic delivery attempt. */
export enum MemoryCatalogAtomicStatuses
{
	/** A new metadata row and matching outbox event committed together. */
	Recorded = "recorded",
	/** An earlier byte-identical idempotency delivery already committed. */
	Idempotent = "idempotent",
	/** Command evidence did not satisfy the catalog's provenance invariant. */
	InvalidCommand = "invalid_command",
	/** The named durable-memory dataset does not exist. */
	DatasetNotFound = "dataset_not_found",
	/** The named durable-memory dataset is no longer available for retention. */
	DatasetRetired = "dataset_retired",
	/** The requested correction cannot supersede the named predecessor. */
	CorrectionConflict = "correction_conflict",
	/** An idempotency key was previously committed for different immutable evidence. */
	Conflict = "conflict",
}

/** Source reference proving where a durable memory fact came from. */
export interface MemoryFactSource
{
	/** Immutable ArtifactRevision source, when derived from an artifact. */
	readonly artifactRevisionId: string | null;
	/** Immutable Message source, when derived from a conversation. */
	readonly messageId: string | null;
	/** True only for an explicit user statement with no artifact or message coordinate. */
	readonly explicitUserStatement: boolean;
	/** Authenticated user who made the explicit statement, otherwise null. */
	readonly explicitUserId: string | null;
}

/** Catalog metadata recorded after Cognee accepts durable fact content. */
export interface RecordMemoryFactCommand
{
	/** OpenCrane dataset catalog identifier. */
	readonly datasetId: string;
	/** Stable external identifier returned by Cognee. */
	readonly cogneeExternalId: string;
	/** Digest of durable fact content without copying that content into Postgres. */
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

/** Persistence boundary committing catalog provenance and Cognee outbox intent together. */
export interface MemoryCatalogRepository
{
	/** Records only metadata and provenance; durable fact content remains in Cognee. */
	recordFactAtomically(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>;
}

/** Post-rollback repository that classifies one committed uniqueness collision. */
export interface MemoryCatalogCollisionRepository
{
	/** Accepts only exact committed idempotency evidence; every other collision remains a conflict. */
	resolveUniqueCollision(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>;
}

/** Repository instances bound to one atomic catalog-delivery transaction. */
export interface MemoryCatalogTransaction
{
	/** Catalog and outbox persistence for this one all-or-nothing delivery. */
	readonly catalog: MemoryCatalogRepository;
}

/** Work that records one catalog delivery through transaction-bound repositories. */
export type MemoryCatalogWork = (transaction: MemoryCatalogTransaction) => Promise<AtomicRecordMemoryFactResult>;

/** Transaction boundary for one durable catalog metadata and outbox delivery. */
export interface MemoryCatalogUnitOfWork
{
	/** Runs one delivery with serialization retry and post-rollback uniqueness resolution. */
	run(command: RecordMemoryFactCommand, work: MemoryCatalogWork): Promise<AtomicRecordMemoryFactResult>;
}

/** Stable outcome of recording memory catalog metadata. */
export type RecordMemoryFactResult =
	| { readonly outcome: "recorded"; readonly idempotent: boolean }
	| { readonly outcome: "denied"; readonly reason: MemoryCatalogAtomicStatuses.InvalidCommand | MemoryCatalogAtomicStatuses.DatasetNotFound | MemoryCatalogAtomicStatuses.DatasetRetired | MemoryCatalogAtomicStatuses.CorrectionConflict | MemoryCatalogAtomicStatuses.Conflict };
