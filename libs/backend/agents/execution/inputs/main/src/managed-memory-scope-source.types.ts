import type { AuthorizationScopeKind, GrantSubjectType } from "@prisma/client";

/** One exact attached knowledge-scope coordinate resolved to a Cognee dataset during admission. */
export interface ManagedMemoryScopeDataset
{
	/** OpenCrane catalog identifier retained in the frozen run snapshot. */
	readonly datasetId: string;
	/** Gateway-native dataset identifier sent only through the memory gateway. */
	readonly cogneeDatasetId: string;
	/** Canonical attached scope name. */
	readonly scope: string;
	/** Canonical target subject type. */
	readonly subjectType: string;
	/** Canonical target subject identifier. */
	readonly subjectId: string;
}

/** Exact scope coordinate used to select one catalogued dataset without accepting runtime input. */
export interface ManagedMemoryScopeSelector
{
	/** Canonical attached scope name. */
	readonly scope: string;
	/** Canonical target subject type. */
	readonly subjectType: string;
	/** Canonical target subject identifier. */
	readonly subjectId: string;
	/** Persisted memory-catalogue scope selected from the canonical snapshot scope. */
	readonly scopeKind: AuthorizationScopeKind;
	/** Persisted target type selected from the canonical snapshot target type. */
	readonly persistedSubjectType: GrantSubjectType;
}
