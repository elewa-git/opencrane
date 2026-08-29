/**
 * API types for the audit-log route.
 */

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import type { Request } from "express";

/**
 * One row of the operator-facing audit log, as returned by GET /audit.
 *
 * These are the readable entries written by the group and tenant routes, not the append-only
 * authorization decisions from PrismaAuditDecisionWriterRepository. `tenant` is part of the contract but the list
 * route does not populate it today.
 */
export interface AuditEntry
{
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
  /** Tenant name the event relates to, if applicable. */
  tenant?: string;
  /** Action or reason code (e.g. "Created", "Deleted"). */
  action: string;
  /** Resource reference (e.g. "Tenant/my-tenant"). */
  resource: string;
  /** Human-readable event message. */
  message: string;
}

/** Authenticated Principal coordinates used for one audit-log read. */
export interface AuditRouteCaller
{
  /** Silo derived from the trusted request host. */
  readonly siloId: string;
  /** Durable local Principal admitted by authentication middleware. */
  readonly principalId: string;
}

/** Resolves trusted audit caller coordinates from one authenticated request. */
export type AuditRouteCallerResolver = (request: Request) => AuditRouteCaller | null;

/** Builds the central authority over the transaction that reads audit entries. */
export type AuditAuthorizationAuthorityFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/** Query coordinates for one keyset-paginated audit-log page. */
export interface AuditPageQuery
{
  /** Maximum number of visible entries returned to the caller. */
  readonly limit: number;
  /** Exclusive timestamp cursor, or null for the newest page. */
  readonly before: Date | null;
}

/** One authorized audit-log page. */
export interface AuditPage
{
  /** Entries that survived the current item-level authorization check. */
  readonly data: readonly AuditEntry[];
	/** Whether the silo-scoped candidate catalogue contains another page. */
	readonly hasMore: boolean;
	/** Timestamp of the last examined candidate, or null when no next page exists. */
	readonly nextCursorAt: Date | null;
}

/** Stored audit fields needed to authorize and map one catalogue row. */
export interface AuditCatalogueCandidate
{
  /** Stable database identifier used as the authorization resource ID. */
  readonly id: number;
  /** Database timestamp used by keyset pagination. */
  readonly timestamp: Date;
  /** Domain action recorded by the event producer. */
  readonly action: string;
  /** Domain resource reference recorded by the event producer. */
  readonly resource: string;
  /** Human-readable event summary. */
  readonly message: string;
}

/** Transaction-scoped audit candidate reader used after the unit of work opens a transaction. */
export interface AuditCatalogueTransactionRepository
{
  /** Lists one lifecycle-eligible candidate batch before item authorization is applied. */
	listCandidates(siloId: string, query: AuditPageQuery): Promise<readonly AuditCatalogueCandidate[]>;
}

/** Lists audit entries through one transaction-bound authorization decision. */
export interface AuditCatalogue
{
  /** Returns only audit entries the current Principal may read. */
  list(caller: AuditRouteCaller, query: AuditPageQuery): Promise<AuditPage>;
}
