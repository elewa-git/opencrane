import { ObotClientNotConfiguredError, _BuildObotClient } from "@opencrane/backend/mcp";
import type { ObotCatalogEntryRef, ObotManagementClient, ObotUpsertCatalogEntryParams } from "@opencrane/backend/mcp";
import { describe, expect, it, vi } from "vitest";

import { RegistryImportValidationError, _ComputeImportSyncState, _ImportRegistryServer } from "../core/registry-import.js";
import { UnsafeRemoteUrlError } from "../core/ssrf.js";
import type { ImportPersistencePort, ImportRegistryServerParams } from "../core/registry-import.types.js";

/**
 * Curated import (folded #218): the one mutation in the discovery→import flow. It
 * SSRF-validates, refuses to re-host packaged servers, imports through the injected
 * Obot adapter, and fails closed (never a fake success) when Obot is unconfigured.
 */

/** A valid import request over a public streamable-http remote. */
function _validParams(overrides: Partial<ImportRegistryServerParams> = {}): ImportRegistryServerParams
{
  return {
    sourceId: "src-1",
    registrySource: "https://registry.example.com",
    obotCatalogId: "cat-1",
    upstreamName: "io.github.acme/db",
    displayName: "ACME DB",
    pinnedVersion: "1.4.0",
    remoteUrl: "https://mcp.acme.com/db",
    remoteTransport: "streamable-http",
    digest: "sha256:abc",
    publisher: "io.github.acme",
    ...overrides,
  };
}

/** A persistence port spy returning a fixed item id. */
function _spyPersistence(): { port: ImportPersistencePort; persist: ReturnType<typeof vi.fn> }
{
  const persist = vi.fn(async function _persist() { return { id: "item-1" }; });
  return { port: { persistImportedItem: persist }, persist };
}

/** An Obot client spy whose upsert returns a stable ref. */
function _obotClientReturning(ref: ObotCatalogEntryRef): { client: ObotManagementClient; upsert: ReturnType<typeof vi.fn> }
{
  const upsert = vi.fn(async function _upsert(_params: ObotUpsertCatalogEntryParams) { return ref; });
  const client = { upsertCatalogEntry: upsert } as unknown as ObotManagementClient;
  return { client, upsert };
}

describe("_ImportRegistryServer (curated import)", function _suite()
{
  it("imports a pinned remote through the adapter with the right args and persists provenance", async function ()
  {
    const { port, persist } = _spyPersistence();
    const { client, upsert } = _obotClientReturning({ catalogId: "cat-1", entryId: "entry-9", pinnedVersion: "1.4.0", digest: "sha256:abc" });

    const result = await _ImportRegistryServer(port, _validParams(), client);

    // The adapter is called with exactly the pinned entry contract.
    expect(upsert).toHaveBeenCalledWith({ catalogId: "cat-1", name: "ACME DB", remoteUrl: "https://mcp.acme.com/db", pinnedVersion: "1.4.0", digest: "sha256:abc" });
    // Provenance + stable ids are persisted only after Obot confirms.
    expect(persist).toHaveBeenCalledOnce();
    const persisted = persist.mock.calls[0][0];
    expect(persisted.metadata.obotEntryId).toBe("entry-9");
    expect(persisted.metadata.remoteUrl).toBe("https://mcp.acme.com/db");
    expect(persisted.metadata.syncState).toBe("in-sync");
    expect(persisted.metadata.provenance.registrySource).toBe("https://registry.example.com");
    expect(result).toMatchObject({ itemId: "item-1", obotEntryId: "entry-9", pinnedVersion: "1.4.0", syncState: "in-sync" });
  });

  it("fails closed with an actionable error when the Obot adapter is unconfigured (default factory)", async function ()
  {
    const { port, persist } = _spyPersistence();
    // Default client = the fail-closed no-op factory.
    await expect(_ImportRegistryServer(port, _validParams(), _BuildObotClient())).rejects.toBeInstanceOf(ObotClientNotConfiguredError);
    // No local item is written for a would-be fake success.
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects an unsafe remote URL before the adapter is ever called", async function ()
  {
    const { port, persist } = _spyPersistence();
    const { client, upsert } = _obotClientReturning({ catalogId: "cat-1", entryId: "e" });
    await expect(_ImportRegistryServer(port, _validParams({ remoteUrl: "https://169.254.169.254/" }), client)).rejects.toBeInstanceOf(UnsafeRemoteUrlError);
    expect(upsert).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("fails closed on a missing pinned version", async function ()
  {
    const { port } = _spyPersistence();
    const { client } = _obotClientReturning({ catalogId: "c", entryId: "e" });
    await expect(_ImportRegistryServer(port, _validParams({ pinnedVersion: "" }), client)).rejects.toBeInstanceOf(RegistryImportValidationError);
  });

  it("refuses to re-host an unsupported (non-remote) runtime", async function ()
  {
    const { port } = _spyPersistence();
    const { client } = _obotClientReturning({ catalogId: "c", entryId: "e" });
    await expect(_ImportRegistryServer(port, _validParams({ remoteTransport: "stdio" as unknown as "streamable-http" }), client)).rejects.toBeInstanceOf(RegistryImportValidationError);
  });
});

describe("_ComputeImportSyncState (reconciliation, never mutates)", function _suite()
{
  it("reports in-sync when version and digest are unchanged", function ()
  {
    expect(_ComputeImportSyncState({ version: "1.0.0", digest: "d1" }, { present: true, version: "1.0.0", digest: "d1" })).toBe("in-sync");
  });

  it("reports update-available on a changed upstream version", function ()
  {
    expect(_ComputeImportSyncState({ version: "1.0.0" }, { present: true, version: "1.1.0" })).toBe("update-available");
  });

  it("reports update-available on a changed digest at the same version", function ()
  {
    expect(_ComputeImportSyncState({ version: "1.0.0", digest: "d1" }, { present: true, version: "1.0.0", digest: "d2" })).toBe("update-available");
  });

  it("reports removed-upstream when the record is gone (never a silent delete)", function ()
  {
    expect(_ComputeImportSyncState({ version: "1.0.0" }, { present: false })).toBe("removed-upstream");
  });
});
