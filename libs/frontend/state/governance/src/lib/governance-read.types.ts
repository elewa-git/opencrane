import type { paths } from "@opencrane/contracts";

/** Query accepted by the generated audit endpoint; its cursor stays opaque to the browser. */
export type GovernanceAuditQuery = NonNullable<paths["/audit"]["get"]["parameters"]["query"]>;

/** Audit page returned after the server filters each candidate by current permission. */
export type GovernanceAuditPage = paths["/audit"]["get"]["responses"][200]["content"]["application/json"];

/** Audit row from the generated response, without a browser-owned copy of its fields. */
export type GovernanceAuditEntry = GovernanceAuditPage["data"][number];

/** Recorded usage rows; the endpoint supplies neither a reporting period nor freshness evidence. */
export type GovernanceTokenUsageRows = paths["/token-usage"]["get"]["responses"][200]["content"]["application/json"];

/** Recorded usage for an account and currency, with an optional matching ceiling. */
export type GovernanceTokenUsage = GovernanceTokenUsageRows[number];

/** Configured global ceiling; the API also returns USD zero when no setting exists. */
export type GovernanceBudget = paths["/ai-budget/global"]["get"]["responses"][200]["content"]["application/json"];

/** Configured account overrides, not a complete account directory. */
export type GovernanceAccountBudgets = paths["/ai-budget/accounts"]["get"]["responses"][200]["content"]["application/json"];

/** Account override from the generated budget response. */
export type GovernanceAccountBudget = GovernanceAccountBudgets[number];

/**
 * Read-only browser access to existing protected reporting endpoints.
 * Empty audit and usage lists do not prove that no records exist. Callers must invalidate pending
 * reads when access changes; aborting prevents the adapter from returning a late successful result.
 */
export interface GovernanceReadGateway
{
	/** Reads one candidate page, retaining a next cursor even when no candidate is visible. */
	readAuditPage(query: GovernanceAuditQuery, signal?: AbortSignal): Promise<GovernanceAuditPage>;
	/** Reads permitted snapshots without inferring live spend or a monthly reporting interval. */
	readTokenUsage(signal?: AbortSignal): Promise<GovernanceTokenUsageRows>;
	/** Reads the global setting after the server checks organisation administration. */
	readGlobalBudget(signal?: AbortSignal): Promise<GovernanceBudget>;
	/** Reads configured overrides after the server checks organisation administration. */
	readAccountBudgets(signal?: AbortSignal): Promise<GovernanceAccountBudgets>;
}

/**
 * Browser-only failure categories used by governance stores; they grant no access and are not
 * persisted. Unknown transport failures become Unavailable rather than exposing server prose.
 */
export enum GovernanceReadErrorKinds
{
	/** The server denied this read; callers must remove retained protected records. */
	AccessDenied = "access_denied",
	/** The session is missing or expired; callers must remove records and require sign-in. */
	Unauthenticated = "unauthenticated",
	/** The read could not complete; retained records are stale until a later successful read. */
	Unavailable = "unavailable",
	/** The response did not satisfy the generated contract and must not become visible data. */
	InvalidResponse = "invalid_response",
}
