import type { DiscoverRegistryParams, DiscoverServerDetailParams, DiscoveredMcpServer, RegistryFetch, RegistryListResult, RegistryRemote, RegistryRepository } from "./registry-discovery.types.js";

/**
 * Read-only discovery client for a standard MCP registry API
 * (registry.modelcontextprotocol.io shape). It ONLY lists and reads: it never
 * calls the Obot adapter, never persists, and never activates a server. An admin
 * browses the normalised results, then triggers a separate, explicit curated
 * import (see `registry-import.ts`) for a single chosen version.
 */

/** Thrown when the registry responds unusably (non-2xx or non-object body). */
export class RegistryUnavailableError extends Error
{
  /** Machine-stable code surfaced to API clients. */
  public readonly code = "REGISTRY_UNAVAILABLE";

  /** Upstream HTTP status, when the failure came from a response (else undefined). */
  public readonly status?: number;

  /**
   * @param reason - Human-readable reason discovery could not complete.
   * @param status - Upstream HTTP status, when the failure was a response.
   */
  constructor(reason: string, status?: number)
  {
    super(`MCP registry discovery failed: ${reason}`);
    this.name = "RegistryUnavailableError";
    this.status = status;
  }
}

/**
 * List (a page of) servers from a registry, normalising each record and marking
 * whether it is importable as a pinned remote entry. Read-only — performs a single
 * GET and returns a cursor for the next page.
 *
 * @param params - Registry base URL, optional cursor/limit, and injected fetch.
 * @returns A page of normalised servers plus the next-page cursor.
 */
export async function _DiscoverRegistryServers(params: DiscoverRegistryParams): Promise<RegistryListResult>
{
  // 1. Resolve the fetch impl — injectable so unit tests never hit the network
  //    and can assert discovery touches no Obot adapter.
  const fetchFn: RegistryFetch = params.fetchFn ?? _globalFetch();

  // 2. Build the list URL with pagination params preserved verbatim.
  const url = new URL("v0/servers", _ensureTrailingSlash(params.baseUrl));
  if (params.cursor !== undefined && params.cursor !== "")
  {
    url.searchParams.set("cursor", params.cursor);
  }
  if (params.limit !== undefined)
  {
    url.searchParams.set("limit", String(params.limit));
  }

  // 3. Fetch and decode the list body defensively (fail closed on a bad shape).
  const body = await _fetchJson(fetchFn, url.toString(), params.signal);
  const record = _asObject(body);
  if (record === undefined)
  {
    throw new RegistryUnavailableError("list response was not a JSON object");
  }

  // 4. Normalise each server record; malformed records are dropped, not surfaced,
  //    so a half-parsed record can never be presented as importable.
  const rawServers = Array.isArray(record.servers) ? record.servers : [];
  const servers: DiscoveredMcpServer[] = [];
  for (const raw of rawServers)
  {
    const normalised = _normaliseServer(raw, params.baseUrl);
    if (normalised !== undefined)
    {
      servers.push(normalised);
    }
  }

  return { servers, nextCursor: _extractNextCursor(record) };
}

/**
 * Fetch one server's version detail from the registry and normalise it. Read-only.
 *
 * @param params - Registry base URL, upstream name, optional version, injected fetch.
 * @returns The normalised discovered server.
 */
export async function _GetRegistryServerDetail(params: DiscoverServerDetailParams): Promise<DiscoveredMcpServer>
{
  // 1. Resolve the fetch impl (injectable, read-only).
  const fetchFn: RegistryFetch = params.fetchFn ?? _globalFetch();

  // 2. Build the detail URL, pinning a specific version when one is requested.
  const url = new URL(`v0/servers/${encodeURIComponent(params.upstreamName)}`, _ensureTrailingSlash(params.baseUrl));
  if (params.version !== undefined && params.version !== "")
  {
    url.searchParams.set("version", params.version);
  }

  // 3. Fetch, decode, and normalise; an unusable record fails closed.
  const body = await _fetchJson(fetchFn, url.toString(), params.signal);
  const server = _normaliseServer(_unwrapServerEnvelope(body), params.baseUrl);
  if (server === undefined)
  {
    throw new RegistryUnavailableError(`server "${params.upstreamName}" detail was malformed`);
  }
  return server;
}

/**
 * Resolve the global `fetch` as the discovery client's default transport.
 *
 * @returns The global fetch, narrowed to the {@link RegistryFetch} surface.
 */
function _globalFetch(): RegistryFetch
{
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== "function")
  {
    throw new RegistryUnavailableError("no global fetch available; inject fetchFn");
  }
  return candidate as unknown as RegistryFetch;
}

/**
 * Perform a GET and decode the JSON body, raising a typed error on any failure.
 *
 * @param fetchFn - The (possibly injected) fetch implementation.
 * @param url - Absolute URL to GET.
 * @param signal - Optional abort signal.
 * @returns The decoded JSON body.
 */
async function _fetchJson(fetchFn: RegistryFetch, url: string, signal?: AbortSignal): Promise<unknown>
{
  // 1. Perform the request, translating transport failures into a typed error.
  let response;
  try
  {
    response = await fetchFn(url, { signal, headers: { accept: "application/json" } });
  }
  catch (cause)
  {
    throw new RegistryUnavailableError(`request to ${url} failed: ${String(cause)}`);
  }

  // 2. Reject any non-2xx status (fail closed rather than parse an error page);
  //    the status is carried so a caller can distinguish an authoritative 404
  //    (upstream removed) from a transient failure.
  if (!response.ok)
  {
    throw new RegistryUnavailableError(`registry returned HTTP ${response.status}`, response.status);
  }

  // 3. Decode the body as JSON, failing closed on invalid JSON.
  try
  {
    return await response.json();
  }
  catch (cause)
  {
    throw new RegistryUnavailableError(`response from ${url} was not valid JSON: ${String(cause)}`);
  }
}

/**
 * Normalise one raw registry server record into a {@link DiscoveredMcpServer}.
 * Preserves every provenance field and computes importability. Returns `undefined`
 * when the record lacks the minimum identity to be usable.
 *
 * @param raw - Untrusted raw record from the registry.
 * @param registrySource - Registry base URL, recorded as provenance.
 * @returns The normalised server, or `undefined` if the record is unusable.
 */
function _normaliseServer(raw: unknown, registrySource: string): DiscoveredMcpServer | undefined
{
  const record = _asObject(raw);
  if (record === undefined)
  {
    return undefined;
  }

  // 1. Upstream name is the canonical identity — without it a record is unusable.
  const upstreamName = _asString(record.name);
  if (upstreamName === undefined)
  {
    return undefined;
  }

  // 2. Extract provenance from the record and the registry `_meta` envelope.
  const meta = _asObject(record._meta) ?? {};
  const official = _asObject(meta["io.modelcontextprotocol.registry/official"]) ?? {};
  const version = _asString(record.version) ?? _asString(official.version);
  const remotes = _extractRemotes(record.remotes);

  // 3. Compute importability: a record needs a pinned version AND a remote endpoint
  //    to become a pinned `runtime: remote` entry. Anything else fails closed —
  //    importing a packaged (stdio) server would mean re-hosting, which we do not do.
  let importable = true;
  let unsupportedReason: string | undefined;
  if (version === undefined)
  {
    importable = false;
    unsupportedReason = "record has no version to pin";
  }
  else if (remotes.length === 0)
  {
    importable = false;
    unsupportedReason = "record advertises no remote endpoint (packaged servers are not re-hosted)";
  }

  return {
    registrySource,
    upstreamName,
    description: _asString(record.description),
    version,
    versionId: _asString(official.id) ?? _asString(official.versionId),
    isLatest: typeof official.isLatest === "boolean" ? official.isLatest : undefined,
    publishedAt: _asString(official.publishedAt),
    publisher: _derivePublisher(upstreamName, record),
    digest: _extractDigest(record, official),
    repository: _extractRepository(record.repository),
    remotes,
    importable,
    unsupportedReason,
  };
}

/**
 * Extract and validate the `remotes` array from a raw record.
 *
 * @param raw - Raw `remotes` value.
 * @returns Well-formed remotes (unknown transports are dropped).
 */
function _extractRemotes(raw: unknown): RegistryRemote[]
{
  if (!Array.isArray(raw))
  {
    return [];
  }
  const remotes: RegistryRemote[] = [];
  for (const entry of raw)
  {
    const record = _asObject(entry);
    const type = record !== undefined ? _asString(record.type) : undefined;
    const url = record !== undefined ? _asString(record.url) : undefined;
    if (url !== undefined && (type === "streamable-http" || type === "sse"))
    {
      remotes.push({ type, url });
    }
  }
  return remotes;
}

/**
 * Extract source-repository provenance from a raw record.
 *
 * @param raw - Raw `repository` value.
 * @returns Normalised repository, or `undefined` when absent/malformed.
 */
function _extractRepository(raw: unknown): RegistryRepository | undefined
{
  const record = _asObject(raw);
  if (record === undefined)
  {
    return undefined;
  }
  const url = _asString(record.url);
  if (url === undefined)
  {
    return undefined;
  }
  return { url, source: _asString(record.source), id: _asString(record.id) };
}

/**
 * Derive a publisher/namespace from the canonical name or an explicit field.
 *
 * @param upstreamName - Canonical server name (e.g. "io.github.acme/db").
 * @param record - The raw record, checked for an explicit publisher field.
 * @returns The publisher string, or `undefined` when it cannot be derived.
 */
function _derivePublisher(upstreamName: string, record: Record<string, unknown>): string | undefined
{
  const explicit = _asString(record.publisher);
  if (explicit !== undefined)
  {
    return explicit;
  }
  const slash = upstreamName.indexOf("/");
  return slash > 0 ? upstreamName.slice(0, slash) : undefined;
}

/**
 * Extract a content digest from a record, preferring an explicit digest, then a
 * registry-official digest.
 *
 * @param record - The raw record.
 * @param official - The `io.modelcontextprotocol.registry/official` meta object.
 * @returns A digest string, or `undefined` when none is present.
 */
function _extractDigest(record: Record<string, unknown>, official: Record<string, unknown>): string | undefined
{
  return _asString(record.digest) ?? _asString(official.digest) ?? _asString(official.contentDigest);
}

/**
 * Read the next-page cursor from a list response's `metadata` envelope.
 *
 * @param record - The decoded list response object.
 * @returns The opaque next cursor, or `undefined` when the last page is reached.
 */
function _extractNextCursor(record: Record<string, unknown>): string | undefined
{
  const metadata = _asObject(record.metadata);
  if (metadata === undefined)
  {
    return undefined;
  }
  return _asString(metadata.next_cursor) ?? _asString(metadata.nextCursor);
}

/**
 * Unwrap a detail response that nests the server under a `server` key.
 *
 * @param body - The decoded detail response.
 * @returns The server sub-object when present, else the body unchanged.
 */
function _unwrapServerEnvelope(body: unknown): unknown
{
  const record = _asObject(body);
  if (record !== undefined && _asObject(record.server) !== undefined)
  {
    return record.server;
  }
  return body;
}

/**
 * Ensure a base URL ends with a slash so `new URL(path, base)` appends correctly.
 *
 * @param baseUrl - The registry base URL.
 * @returns The base URL guaranteed to end with a slash.
 */
function _ensureTrailingSlash(baseUrl: string): string
{
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

/**
 * Narrow an unknown value to a plain object.
 *
 * @param value - Value to test.
 * @returns The value as a record, or `undefined` when it is not a plain object.
 */
function _asObject(value: unknown): Record<string, unknown> | undefined
{
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Narrow an unknown value to a non-empty string.
 *
 * @param value - Value to test.
 * @returns The trimmed string, or `undefined` when it is not a usable string.
 */
function _asString(value: unknown): string | undefined
{
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
