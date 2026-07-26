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

/** Gateway-confirmed coordinates for the one personal dataset of a verified user scope. */
export interface ProvisionPersonalMemoryDatasetCommand
{
	/** Silo containing the signed membership and product catalog. */
	readonly siloId: string;
	/** Organization from the exact verified membership assertion. */
	readonly organizationId: string;
	/** User who exclusively owns the Personal dataset. */
	readonly subjectId: string;
	/** Gateway-minted durable dataset identifier. */
	readonly cogneeDatasetId: string;
	/** Principal that initiated the authenticated provisioning flow. */
	readonly createdBy: string;
}

/** Atomic catalog registration outcome for one gateway-confirmed personal dataset. */
export type AtomicProvisionPersonalMemoryDatasetResult = { readonly status: "provisioned" } | { readonly status: "idempotent" } | { readonly status: "invalid_command" } | { readonly status: "conflict" };

/** Persistence boundary that registers a gateway dataset under one immutable verified scope. */
export interface PersonalMemoryDatasetRepository
{
	/** Creates the catalog row or accepts only the exact prior scope-to-gateway binding. */
	provisionPersonalDatasetAtomically(command: ProvisionPersonalMemoryDatasetCommand): Promise<AtomicProvisionPersonalMemoryDatasetResult>;
}

/** Public outcome of registering a gateway-confirmed personal dataset in the catalog. */
export type ProvisionPersonalMemoryDatasetResult = { readonly outcome: "provisioned"; readonly idempotent: boolean } | { readonly outcome: "denied"; readonly reason: "invalid_command" | "conflict" };

/** Stable outcome of recording memory catalog metadata. */
export type RecordMemoryFactResult =
	| { readonly outcome: "recorded"; readonly idempotent: boolean }
	| { readonly outcome: "denied"; readonly reason: "invalid_command" | "dataset_not_found" | "dataset_retired" | "correction_conflict" | "conflict" };
