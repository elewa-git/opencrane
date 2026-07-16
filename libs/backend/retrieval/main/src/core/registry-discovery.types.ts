/**
 * Types for read-only discovery against a standard MCP registry API
 * (registry.modelcontextprotocol.io shape: `GET /v0/servers` list with a
 * `metadata.next_cursor`, and `GET /v0/servers/{name}` version detail). Discovery
 * NEVER mutates Obot or activates anything — these shapes only describe what an
 * admin can browse before an explicit curated import (italanta/opencrane#128, #218).
 */

import type { HostLookup } from "./ssrf.types.js";

/** Minimal `fetch` surface the discovery client depends on (injectable for tests). */
export type RegistryFetch = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<RegistryFetchResponse>;

/** The subset of the Fetch `Response` the discovery client reads. */
export interface RegistryFetchResponse
{
  /** Whether the HTTP status is in the 2xx range. */
  ok: boolean;
  /** HTTP status code, surfaced on non-2xx for actionable errors. */
  status: number;
  /** Parse the body as JSON. */
  json(): Promise<unknown>;
}

/** A remote endpoint an upstream server advertises (streamable-http is the norm). */
export interface RegistryRemote
{
  /** Transport the remote speaks. */
  type: "streamable-http" | "sse";
  /** Fully-qualified remote URL — untrusted until SSRF-validated before import. */
  url: string;
}

/** Source-repository provenance an upstream record carries, when present. */
export interface RegistryRepository
{
  /** Repository URL (e.g. the GitHub project). */
  url: string;
  /** Repository host identifier (e.g. "github"). */
  source?: string;
  /** Stable repository id at the source, when provided. */
  id?: string;
}

/**
 * A normalised discovered MCP server. Every field is preserved from the upstream
 * record so a later import records complete provenance; `importable` captures
 * whether this record can become a pinned `runtime: remote` catalog entry.
 */
export interface DiscoveredMcpServer
{
  /** Registry base URL this record was discovered from (provenance). */
  registrySource: string;
  /** Upstream identity — the registry's canonical server name (e.g. "io.github.acme/db"). */
  upstreamName: string;
  /** Human description, when the upstream provides one. */
  description?: string;
  /** Selected/reported version this record represents (the version to pin on import). */
  version?: string;
  /** Upstream registry version id, when the registry exposes one (provenance). */
  versionId?: string;
  /** Whether the registry flags this version as the current latest. */
  isLatest?: boolean;
  /** Upstream publish timestamp (ISO 8601), when known (provenance). */
  publishedAt?: string;
  /** Publisher/namespace derived from the record (provenance). */
  publisher?: string;
  /** Content digest reported for the pinned version, when the registry exposes one. */
  digest?: string;
  /** Source repository provenance, when present. */
  repository?: RegistryRepository;
  /** Remote endpoints advertised by the record. */
  remotes: RegistryRemote[];
  /** Whether this record can be imported as a pinned remote catalog entry. */
  importable: boolean;
  /** Why the record is not importable, when `importable` is false. */
  unsupportedReason?: string;
}

/** A page of discovered servers plus an opaque cursor for the next page. */
export interface RegistryListResult
{
  /** Normalised servers on this page. */
  servers: DiscoveredMcpServer[];
  /** Opaque cursor for the next page, or `undefined` when exhausted. */
  nextCursor?: string;
}

/** Parameters for a single discovery list call. */
export interface DiscoverRegistryParams
{
  /** Registry base URL (the `ThirdPartySource.originUrl` of an mcp-registry source). */
  baseUrl: string;
  /** Opaque cursor from a prior page, when paginating. */
  cursor?: string;
  /** Page size hint passed through to the registry. */
  limit?: number;
  /** Injected fetch implementation; defaults to the global `fetch`. */
  fetchFn?: RegistryFetch;
  /** Injected DNS resolver (real-fetch path only); defaults to the system resolver. */
  lookupFn?: HostLookup;
  /** Abort signal to bound the request, when the caller enforces a timeout. */
  signal?: AbortSignal;
}

/** Parameters for fetching one server's version detail. */
export interface DiscoverServerDetailParams
{
  /** Registry base URL. */
  baseUrl: string;
  /** Upstream canonical server name to fetch. */
  upstreamName: string;
  /** Specific version to fetch; omit for the registry's latest. */
  version?: string;
  /** Injected fetch implementation; defaults to the global `fetch`. */
  fetchFn?: RegistryFetch;
  /** Injected DNS resolver (real-fetch path only); defaults to the system resolver. */
  lookupFn?: HostLookup;
  /** Abort signal to bound the request. */
  signal?: AbortSignal;
}
