/**
 * Types for the org knowledge retrieval API.
 * Shared between the retrieval route and conformance tests.
 */

/**
 * How wide a body of knowledge a retrieval query is asking against.
 *
 * The scope does two jobs at once, which is why it appears in both the request and the
 * response: it decides which dataset is searched, and it decides what the caller must be
 * allowed to read. Widening the scope on a request therefore widens the authorisation check
 * too — it is not a filter applied afterwards.
 *
 * Declaration order here is NOT meaningful. For relevance ordering use
 * {@link DATASET_SCOPE_RETRIEVAL_PRECEDENCE}, which is the single source of truth for it.
 */
export enum DatasetScope
{
  /** Everything shared across the whole organisation. The broadest scope, and the default when none is given. */
  Org = "org",
  /** One team's material. */
  Team = "team",
  /** One department's material; wider than a team, narrower than the organisation. */
  Department = "department",
  /** One project's material. */
  Project = "project",
  /** The caller's own material. The narrowest scope, and the most relevant to them. */
  Personal = "personal",
}

/**
 * Canonical retrieval relevance order, MOST → LEAST relevant. The agent's retrieval chain
 * consults datasets in this order — the caller's own self/session (Personal) is the most
 * specific and relevant context, widening outward through Project → Team → Department to the
 * broad Org corpus (still pullable, just lower-priority context). This is a RELEVANCE ranking
 * of the scope tiers; it is unrelated to how subjects are sorted within a single tier (that
 * sort is only for deterministic dedup/diffing). The single source of truth for scope ordering
 * so the derivation, the contract, and the scope-aware retrieval plugin never disagree.
 */
export const DATASET_SCOPE_RETRIEVAL_PRECEDENCE: readonly DatasetScope[] = [
  DatasetScope.Personal,
  DatasetScope.Project,
  DatasetScope.Team,
  DatasetScope.Department,
  DatasetScope.Org,
];

/**
 * Body of a retrieval query.
 *
 * `tenantName` is what the authorisation check is resolved against, so a caller cannot broaden
 * their reach by naming a different tenant here. `datasetScope` defaults to
 * {@link DatasetScope.Org} and `datasetId` defaults to `default` for org scope, which means
 * omitting both gives the widest search rather than the narrowest — pass them explicitly when
 * you mean something narrower.
 */
export interface RetrievalQueryRequest
{
  /** Full-text search query string. */
  query: string;

  /** Subject used to resolve retrieval authorization. */
  tenantName: string;

  /** Optional team scope to restrict results to documents owned by a team. */
  teamScope?: string;

  /** Dataset scope used for retrieval authorization (defaults to "org"). */
  datasetScope?: DatasetScope;

  /** Dataset identifier inside the selected scope (defaults to "default" for org scope). */
  datasetId?: string;

  /** Maximum number of results to return (default: 20, max: 100). */
  limit?: number;
}

/** A single document result returned from the org index. */
export interface RetrievalResult
{
  /** Unique document identifier. */
  id: string;

  /** Source system that produced this document (e.g. "slack", "confluence"). */
  source: string;

  /** Source-system native identifier for deduplication. */
  sourceId: string;

  /** Owner identifier (team name or user email). */
  owner: string;

  /** Optional team scope the document belongs to. */
  teamScope?: string;

  /** Sensitivity classification tags applied during ingestion. */
  sensitivityTags: string[];

  /** Document title, if available. */
  title?: string;

  /** Plain-text content excerpt (may be truncated for large documents). */
  contentExcerpt: string;

  /** ISO-8601 ingestion timestamp. */
  ingestedAt: string;
}

/**
 * A successful retrieval answer.
 *
 * `datasetScope` and `datasetId` are echoed back as the values actually USED after defaults
 * were applied, so a client can see which body of knowledge answered. `count` is the number of
 * results in this response, not the number of documents that matched. `authOutcome` records
 * what was written to the audit log; a `denied` outcome still arrives as a success response
 * with no results.
 */
export interface RetrievalQueryResponse
{
  /** Documents that matched the query and passed authorization checks. */
  results: RetrievalResult[];

  /** Total number of results returned (may be less than total matching). */
  count: number;

  /** Authorization outcome written to the audit log. */
  authOutcome: "allowed" | "denied";

  /** ISO-8601 timestamp of when this query was evaluated. */
  queriedAt: string;

  /** Effective dataset scope used for this query. */
  datasetScope: DatasetScope;

  /** Effective dataset identifier used for this query. */
  datasetId: string;
}

/** Retrieval error response body. */
export interface RetrievalErrorResponse
{
  /** Machine-readable error code. */
  code: "UNAUTHORIZED" | "TENANT_NOT_FOUND" | "POLICY_DENIED" | "INTERNAL_ERROR";

  /** Human-readable error description. */
  error: string;
}
