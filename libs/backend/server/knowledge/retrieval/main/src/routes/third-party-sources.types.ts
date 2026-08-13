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
