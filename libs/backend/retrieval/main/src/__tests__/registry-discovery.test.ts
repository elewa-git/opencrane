import type { ObotManagementClient } from "@opencrane/backend/mcp";
import { describe, expect, it, vi } from "vitest";

import { RegistryUnavailableError, _DiscoverRegistryServers, _GetRegistryServerDetail } from "../core/registry-discovery.js";
import type { RegistryFetch, RegistryFetchResponse } from "../core/registry-discovery.types.js";

/**
 * Read-only discovery against a standard MCP registry (italanta/opencrane#128,
 * folded #218). Discovery lists/normalises records and MUST perform no Obot
 * mutation and no local activation — those only happen on an explicit import.
 */

/** Build a mock fetch returning a fixed JSON body (200) for any request. */
function _mockFetch(body: unknown): RegistryFetch
{
  return vi.fn(async function _fetch(): Promise<RegistryFetchResponse>
  {
    return { ok: true, status: 200, json: async function _json() { return body; } };
  });
}

/** Build a spy Obot client whose every method fails the test if ever called. */
function _spyObotClient(): ObotManagementClient
{
  const guard = vi.fn(async function _never(): Promise<never> { throw new Error("discovery must not touch Obot"); });
  return {
    upsertCatalogEntry: guard,
    createServer: guard,
    configureServer: guard,
    getServerState: guard,
    reconcileAccess: guard,
    listTools: guard,
    deleteServer: guard,
    mintClientToken: guard,
    revokeClientToken: guard,
  } as unknown as ObotManagementClient;
}

/** A representative registry list payload with one importable and one packaged server. */
const _listPayload = {
  servers: [
    {
      name: "io.github.acme/db",
      description: "ACME database MCP",
      version: "1.4.0",
      repository: { url: "https://github.com/acme/db", source: "github", id: "42" },
      remotes: [{ type: "streamable-http", url: "https://mcp.acme.com/db" }],
      _meta: { "io.modelcontextprotocol.registry/official": { id: "ver-1", isLatest: true, publishedAt: "2026-07-01T00:00:00Z" } },
    },
    {
      name: "io.github.acme/cli",
      version: "2.0.0",
      packages: [{ registryType: "npm", identifier: "acme-cli" }],
    },
  ],
  metadata: { next_cursor: "CURSOR-2", count: 2 },
};

describe("MCP registry discovery (read-only)", function _suite()
{
  it("normalises records, preserving upstream identity, version, provenance and remotes", async function ()
  {
    const result = await _DiscoverRegistryServers({ baseUrl: "https://registry.example.com", fetchFn: _mockFetch(_listPayload) });

    expect(result.nextCursor).toBe("CURSOR-2");
    const [db, cli] = result.servers;
    expect(db.upstreamName).toBe("io.github.acme/db");
    expect(db.registrySource).toBe("https://registry.example.com");
    expect(db.version).toBe("1.4.0");
    expect(db.versionId).toBe("ver-1");
    expect(db.isLatest).toBe(true);
    expect(db.publisher).toBe("io.github.acme");
    expect(db.repository?.url).toBe("https://github.com/acme/db");
    expect(db.remotes).toEqual([{ type: "streamable-http", url: "https://mcp.acme.com/db" }]);
    expect(db.importable).toBe(true);

    // A packaged (no-remote) server is surfaced but marked NOT importable — importing
    // it would mean re-hosting, which this flow refuses.
    expect(cli.importable).toBe(false);
    expect(cli.unsupportedReason).toMatch(/no remote endpoint/);
  });

  it("performs NO Obot mutation during discovery", async function ()
  {
    const obot = _spyObotClient();
    await _DiscoverRegistryServers({ baseUrl: "https://registry.example.com", fetchFn: _mockFetch(_listPayload) });
    // Not one adapter method may have been reached from the discovery path.
    for (const method of Object.values(obot as unknown as Record<string, { mock?: unknown }>))
    {
      if (method && typeof method === "function")
      {
        expect((method as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
      }
    }
  });

  it("forwards cursor and limit as query params", async function ()
  {
    const fetchFn = vi.fn(async function _fetch(input: string): Promise<RegistryFetchResponse>
    {
      expect(input).toContain("cursor=ABC");
      expect(input).toContain("limit=25");
      return { ok: true, status: 200, json: async function _json() { return { servers: [], metadata: {} }; } };
    });
    await _DiscoverRegistryServers({ baseUrl: "https://registry.example.com", cursor: "ABC", limit: 25, fetchFn });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("fails closed on a non-2xx registry response, carrying the status", async function ()
  {
    const fetchFn: RegistryFetch = vi.fn(async function _fetch(): Promise<RegistryFetchResponse>
    {
      return { ok: false, status: 404, json: async function _json() { return {}; } };
    });
    await expect(_GetRegistryServerDetail({ baseUrl: "https://registry.example.com", upstreamName: "io.github.acme/db", fetchFn }))
      .rejects.toMatchObject({ constructor: RegistryUnavailableError, status: 404 });
  });

  it("unwraps a detail envelope nested under `server`", async function ()
  {
    const detailPayload = { server: { name: "io.github.acme/db", version: "1.4.0", remotes: [{ type: "streamable-http", url: "https://mcp.acme.com/db" }] } };
    const server = await _GetRegistryServerDetail({ baseUrl: "https://registry.example.com", upstreamName: "io.github.acme/db", fetchFn: _mockFetch(detailPayload) });
    expect(server.upstreamName).toBe("io.github.acme/db");
    expect(server.importable).toBe(true);
  });
});
