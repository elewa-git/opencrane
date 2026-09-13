/**
 * The kinds of upstream registry OpenCrane can discover MCP servers from.
 *
 * These values describe upstream discovery sources retained by the retrieval inventory.
 */
export enum ThirdPartySourceKind
{
  McpRegistry = "mcp-registry",
  AnthropicSkills = "anthropic-skills",
  GitRepository = "git-repository",
  ManualUpload = "manual-upload",
}

/** Sync or approval state returned for a third-party source. */
export enum ThirdPartySourceStatus
{
  Healthy = "healthy",
  Syncing = "syncing",
  Error = "error",
  PendingApproval = "pending-approval",
}

/** Synchronization mode configured for a source. */
export enum ThirdPartySourceSyncMode
{
  Scheduled = "scheduled",
  Manual = "manual",
}

/** Supported discovered item kinds linked to a source. */
export enum ThirdPartySourceItemKind
{
  McpServer = "mcp-server",
}

/**
 * Shared contract for a discovered source item.
 *
 * Items describe candidates found upstream before they are installed into the
 * first-party MCP catalog.
 */
export interface ThirdPartySourceItem
{
  /** Stable item identifier when persisted locally. */
  id?: string;
  /** Upstream item kind. */
  kind: ThirdPartySourceItemKind;
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

/**
 * One upstream registry OpenCrane discovers MCP servers from.
 *
 * Even when another registry or runtime performs the discovery, OpenCrane stays the source of
 * truth for approval, scheduling, and audit state — so a consumer must read those from here and
 * never from the upstream registry.
 */
export interface ThirdPartySource
{
  /** Stable source identifier. */
  id: string;
  /** Human-readable source name. */
  name: string;
  /** Source integration kind. */
  kind: ThirdPartySourceKind;
  /** Current sync or approval state. */
  status: ThirdPartySourceStatus;
  /** Source origin URL. */
  originUrl: string;
  /** Whether synchronization is scheduled or manual. */
  syncMode: ThirdPartySourceSyncMode;
  /** Number of managed items discovered from the source. */
  managedItemCount: number;
  /** Discovered items linked to the source. */
  items: ThirdPartySourceItem[];
  /** Last successful sync timestamp. */
  lastSyncedAt?: string;
  /** Next scheduler execution time when applicable. */
  nextRunAt?: string;
  /** Optional operator note. */
  notes?: string;
}
