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
	readonly consentState: "explicit" | "confirmed";
	/** User-visible sensitivity classification. */
	readonly sensitivity: string;
	/** Structured provenance kept for explanation and correction. */
	readonly provenance: Readonly<Record<string, unknown>>;
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
export type AtomicRecordMemoryFactResult = { readonly status: "recorded" } | { readonly status: "idempotent" } | { readonly status: "invalid_command" } | { readonly status: "dataset_not_found" } | { readonly status: "dataset_retired" } | { readonly status: "correction_conflict" } | { readonly status: "conflict" };

/** Persistence boundary committing catalog provenance and Cognee outbox intent together. */
export interface MemoryCatalogRepository
{
	/** Records only metadata and provenance; durable fact content remains in Cognee. */
	recordFactAtomically(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>;
}

/** Stable outcome of recording memory catalog metadata. */
export type RecordMemoryFactResult =
	| { readonly outcome: "recorded"; readonly idempotent: boolean }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "dataset_not_found" | "dataset_retired" | "correction_conflict" | "conflict" };
