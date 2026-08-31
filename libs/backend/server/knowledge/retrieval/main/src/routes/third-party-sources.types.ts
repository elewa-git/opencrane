import type { Request } from "express";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { ThirdPartySource } from "@opencrane/contracts";

/**
 * The kinds of upstream a third-party source can be: an MCP registry, an Anthropic skills
 * collection, a git repository, or a manual upload.
 *
 * These hyphenated values are the API form. The database stores the same set in PascalCase, and
 * `_MapThirdPartySource` in third-party-sources.ts converts between them by string
 * replacement — so adding a kind means adding it in both places or the conversion silently
 * passes the raw database value through.
 */
export type ThirdPartySourceRouteKind = "mcp-registry" | "anthropic-skills" | "git-repository" | "manual-upload";

/** State of a source: syncing normally, in progress, failed, or waiting for an operator to approve it. Same PascalCase-to-hyphen conversion caveat as the kind above. */
export type ThirdPartySourceRouteStatus = "healthy" | "syncing" | "error" | "pending-approval";

/** Supported discovered item kinds linked to a source. */
export type ThirdPartySourceItemRouteKind = "mcp-server";

/** Request body used to create or update a source item. */
export interface ThirdPartySourceItemInput
{
  /** Upstream item kind. */
  kind: ThirdPartySourceItemRouteKind;
  /** Human-readable item name. */
  name: string;
  /** Stable upstream identifier. */
  upstreamId: string;
  /** Optional upstream version label. */
  version?: string;
  /** Optional content digest supplied by the upstream registry. */
  digest?: string;
  /** Optional raw metadata preserved for later install steps. */
  metadata?: Record<string, unknown>;
}

/** Request body used to create or update a third-party source. */
export interface ThirdPartySourceWriteRequest
{
  /** Human-readable source name. */
  name: string;
  /** Source integration kind. */
  kind: ThirdPartySourceRouteKind;
  /** Current sync or approval state. */
  status?: ThirdPartySourceRouteStatus;
  /** Source origin URL. */
  originUrl: string;
  /** Whether synchronization is scheduled or manual. */
  syncMode: "scheduled" | "manual";
  /** Optional last successful sync timestamp. */
  lastSyncedAt?: string;
  /** Optional next scheduler execution time. */
  nextRunAt?: string;
  /** Optional operator note. */
  notes?: string;
  /** Discovered items currently tracked for the source. */
  items?: ThirdPartySourceItemInput[];
}

/** Authenticated Principal coordinates used for source governance. */
export interface ThirdPartySourceRouteCaller
{
  /** Silo derived from the trusted request host. */
  readonly siloId: string;
  /** Durable local Principal admitted by authentication middleware. */
  readonly principalId: string;
}

/** Resolves trusted source-governance caller coordinates from one request. */
export type ThirdPartySourceRouteCallerResolver = (request: Request) => ThirdPartySourceRouteCaller | null;

/** Builds the central authority over the transaction that owns a source operation. */
export type ThirdPartySourceAuthorizationAuthorityFactory<Transaction> = (transaction: Transaction) => AuthorizationAuthority;

/** Transaction-scoped source persistence used after the unit of work owns authorization. */
export interface ThirdPartySourceTransactionRepository
{
  /** Lists every source in newest-first order. */
  list(siloId: string): Promise<readonly ThirdPartySource[]>;
  /** Reads one source and its discovered items. */
  get(siloId: string, sourceId: string): Promise<ThirdPartySource | null>;
  /** Creates one source, its item inventory, and the operator audit event. */
  create(siloId: string, body: ThirdPartySourceWriteRequest): Promise<{ readonly id: string; readonly status: "created" }>;
  /** Updates one source, replaces its items, and appends the operator audit event. */
  update(siloId: string, sourceId: string, body: Partial<ThirdPartySourceWriteRequest>): Promise<{ readonly id: string; readonly status: "updated" }>;
  /** Deletes one source and appends the operator audit event. */
  delete(siloId: string, sourceId: string): Promise<{ readonly id: string; readonly status: "deleted" }>;
}

/** Central-authorized third-party source governance contract. */
export interface ThirdPartySourceAuthority
{
  /** Lists sources after current organisation administration succeeds. */
  list(caller: ThirdPartySourceRouteCaller): Promise<readonly ThirdPartySource[]>;
  /** Reads one source after current organisation administration succeeds. */
  get(caller: ThirdPartySourceRouteCaller, sourceId: string): Promise<ThirdPartySource | null>;
  /** Creates one source with decision evidence in the same transaction. */
  create(caller: ThirdPartySourceRouteCaller, body: ThirdPartySourceWriteRequest): Promise<{ readonly id: string; readonly status: "created" }>;
  /** Updates one source with decision evidence in the same transaction. */
  update(caller: ThirdPartySourceRouteCaller, sourceId: string, body: Partial<ThirdPartySourceWriteRequest>): Promise<{ readonly id: string; readonly status: "updated" }>;
  /** Deletes one source with decision evidence in the same transaction. */
  delete(caller: ThirdPartySourceRouteCaller, sourceId: string): Promise<{ readonly id: string; readonly status: "deleted" }>;
}
