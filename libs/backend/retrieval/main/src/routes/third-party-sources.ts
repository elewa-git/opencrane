import { Router, type Request } from "express";
import { _BuildObotClient, ObotClientNotConfiguredError } from "@opencrane/backend/mcp";
import type { ObotManagementClient } from "@opencrane/backend/mcp";
import type { ThirdPartySource, ThirdPartySourceItem } from "@opencrane/contracts";
import type { PrismaClient } from "@prisma/client";

import { RegistryUnavailableError, _DiscoverRegistryServers, _GetRegistryServerDetail } from "../core/registry-discovery.js";
import { RegistryImportValidationError, _ComputeImportSyncState, _ImportRegistryServer } from "../core/registry-import.js";
import { UnsafeRemoteUrlError, _AssertSafeRemoteUrl } from "../core/ssrf.js";
import { _RequireOrgAdmin } from "@opencrane/infra/auth";
import type { ImportPersistencePort, ImportRegistryServerParams, ImportedItemMetadata } from "../core/registry-import.types.js";
import type { ThirdPartySourceWriteRequest } from "./third-party-sources.types.js";

/**
 * CRUD + external-registry discovery/import router for third-party sources.
 *
 * @param prisma - Prisma client used for persistence.
 * @param obotClient - Obot management client for curated imports; defaults to the
 *   fail-closed factory so an unconfigured Obot surfaces an actionable error.
 * @returns Configured Express router.
 */
export function thirdPartySourcesRouter(prisma: PrismaClient, obotClient: ObotManagementClient = _BuildObotClient()): Router
{
  const router = Router();

  /** List all configured third-party sources with discovered item counts. */
  router.get("/", async function _listThirdPartySources(req, res)
  {
    const sources = await (prisma as unknown as {
      thirdPartySource: {
        findMany: (args: { orderBy: { createdAt: "desc" }; include: { items: true } }) => Promise<Array<Record<string, unknown>>>;
      };
    }).thirdPartySource.findMany({
      orderBy: { createdAt: "desc" },
      include: { items: true },
    });

    res.json(sources.map(function _mapSource(source)
    {
      return _MapThirdPartySource(source);
    }));
  });

  /** Get a single third-party source and its discovered items. */
  router.get("/:id", async function _getThirdPartySource(req, res)
  {
    const source = await (prisma as unknown as {
      thirdPartySource: {
        findUnique: (args: { where: { id: string }; include: { items: true } }) => Promise<Record<string, unknown> | null>;
      };
    }).thirdPartySource.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });

    if (!source)
    {
      res.status(404).json({ error: "Third-party source not found", code: "THIRD_PARTY_SOURCE_NOT_FOUND" });
      return;
    }

    res.json(_MapThirdPartySource(source));
  });

  /** Create a new third-party source and its discovered item inventory. */
  router.post("/", _RequireOrgAdmin(), async function _createThirdPartySource(req, res)
  {
    const body = req.body as ThirdPartySourceWriteRequest;
    const createdSource = await (prisma as unknown as {
      thirdPartySource: {
        create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; name: string }>;
      };
      thirdPartySourceItem: {
        createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>;
      };
      auditEntry: {
        create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      };
    }).thirdPartySource.create({
      data: {
        name: body.name,
        kind: body.kind,
        status: body.status ?? "pending-approval",
        originUrl: body.originUrl,
        syncMode: body.syncMode,
        ...(body.lastSyncedAt ? { lastSyncedAt: new Date(body.lastSyncedAt) } : {}),
        ...(body.nextRunAt ? { nextRunAt: new Date(body.nextRunAt) } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      },
    });

    if (body.items && body.items.length > 0)
    {
      await (prisma as unknown as {
        thirdPartySourceItem: {
          createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>;
        };
      }).thirdPartySourceItem.createMany({
        data: body.items.map(function _mapItem(item)
        {
          return {
            sourceId: createdSource.id,
            kind: item.kind,
            name: item.name,
            upstreamId: item.upstreamId,
            version: item.version,
            digest: item.digest,
            metadata: item.metadata,
          };
        }),
      });
    }

    await (prisma as unknown as {
      auditEntry: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
    }).auditEntry.create({
      data: {
        action: "Created",
        resource: `ThirdPartySource/${createdSource.id}`,
        message: `Third-party source ${createdSource.name} created`,
      },
    });

    res.status(201).json({ id: createdSource.id, status: "created" });
  });

  /** Update a third-party source and fully replace its discovered item inventory. */
  router.put("/:id", _RequireOrgAdmin(), async function _updateThirdPartySource(req: Request<{ id: string }>, res)
  {
    const body = req.body as Partial<ThirdPartySourceWriteRequest>;
    await (prisma as unknown as {
      thirdPartySource: {
        update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
      };
      thirdPartySourceItem: {
        deleteMany: (args: { where: { sourceId: string } }) => Promise<unknown>;
        createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>;
      };
      auditEntry: {
        create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
      };
    }).thirdPartySource.update({
      where: { id: req.params.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.originUrl ? { originUrl: body.originUrl } : {}),
        ...(body.syncMode ? { syncMode: body.syncMode } : {}),
        ...(body.lastSyncedAt !== undefined ? { lastSyncedAt: body.lastSyncedAt ? new Date(body.lastSyncedAt) : null } : {}),
        ...(body.nextRunAt !== undefined ? { nextRunAt: body.nextRunAt ? new Date(body.nextRunAt) : null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });

    await (prisma as unknown as {
      thirdPartySourceItem: {
        deleteMany: (args: { where: { sourceId: string } }) => Promise<unknown>;
        createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>;
      };
    }).thirdPartySourceItem.deleteMany({ where: { sourceId: req.params.id } });

    if (body.items && body.items.length > 0)
    {
      await (prisma as unknown as {
        thirdPartySourceItem: {
          createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>;
        };
      }).thirdPartySourceItem.createMany({
        data: body.items.map(function _mapItem(item)
        {
          return {
            sourceId: req.params.id,
            kind: item.kind,
            name: item.name,
            upstreamId: item.upstreamId,
            version: item.version,
            digest: item.digest,
            metadata: item.metadata,
          };
        }),
      });
    }

    await (prisma as unknown as {
      auditEntry: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
    }).auditEntry.create({
      data: {
        action: "Updated",
        resource: `ThirdPartySource/${req.params.id}`,
        message: `Third-party source ${req.params.id} updated`,
      },
    });

    res.json({ id: req.params.id, status: "updated" });
  });

  /** Delete a third-party source and its discovered items. */
  router.delete("/:id", _RequireOrgAdmin(), async function _deleteThirdPartySource(req: Request<{ id: string }>, res)
  {
    await (prisma as unknown as {
      thirdPartySourceItem: { deleteMany: (args: { where: { sourceId: string } }) => Promise<unknown> };
      thirdPartySource: { delete: (args: { where: { id: string } }) => Promise<unknown> };
      auditEntry: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
    }).thirdPartySourceItem.deleteMany({ where: { sourceId: req.params.id } });
    await (prisma as unknown as {
      thirdPartySource: { delete: (args: { where: { id: string } }) => Promise<unknown> };
    }).thirdPartySource.delete({ where: { id: req.params.id } });
    await (prisma as unknown as {
      auditEntry: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
    }).auditEntry.create({
      data: {
        action: "Deleted",
        resource: `ThirdPartySource/${req.params.id}`,
        message: `Third-party source ${req.params.id} deleted`,
      },
    });
    res.json({ id: req.params.id, status: "deleted" });
  });

  /**
   * Discover (list, paginated) MCP servers from the source's external registry.
   * Read-only: performs NO Obot mutation and NO local activation.
   */
  router.get("/:id/discover", _RequireOrgAdmin(), async function _discoverRegistryServers(req: Request<{ id: string }>, res)
  {
    // 1. Resolve the registry base URL from the source and confirm it is safe to dial.
    const source = await _loadSourceRegistryUrl(prisma, req.params.id, res);
    if (source === undefined)
    {
      return;
    }

    // 2. List a page of servers from the registry (read-only) and return the cursor.
    try
    {
      const page = await _DiscoverRegistryServers({
        baseUrl: source.originUrl,
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        limit: typeof req.query.limit === "string" ? Number(req.query.limit) : undefined,
      });
      res.json(page);
    }
    catch (err)
    {
      _sendRegistryError(res, err);
    }
  });

  /** Fetch one server's pinned version detail from the source's external registry (read-only). */
  router.get("/:id/discover/detail", _RequireOrgAdmin(), async function _discoverServerDetail(req: Request<{ id: string }>, res)
  {
    // 1. Resolve + validate the registry base URL.
    const source = await _loadSourceRegistryUrl(prisma, req.params.id, res);
    if (source === undefined)
    {
      return;
    }

    // 2. The upstream server name is required to address the detail endpoint.
    const upstreamName = typeof req.query.name === "string" ? req.query.name : "";
    if (upstreamName === "")
    {
      res.status(400).json({ error: "Query param 'name' is required", code: "MISSING_SERVER_NAME" });
      return;
    }

    // 3. Fetch and return the normalised detail record (read-only).
    try
    {
      const server = await _GetRegistryServerDetail({
        baseUrl: source.originUrl,
        upstreamName,
        version: typeof req.query.version === "string" ? req.query.version : undefined,
      });
      res.json(server);
    }
    catch (err)
    {
      _sendRegistryError(res, err);
    }
  });

  /**
   * Curated import: import ONE chosen, pinned version as a local Obot catalog entry.
   * The only mutation in this flow. SSRF-validated, fail-closed on an unconfigured
   * Obot adapter, and never auto-activating or granting access.
   */
  router.post("/:id/import", _RequireOrgAdmin(), async function _importRegistryServer(req: Request<{ id: string }>, res)
  {
    const body = req.body as Partial<ImportRegistryServerParams>;

    // 1. Resolve + validate the registry base URL (recorded as import provenance).
    const source = await _loadSourceRegistryUrl(prisma, req.params.id, res);
    if (source === undefined)
    {
      return;
    }

    // 1b. Import requires an APPROVED source: a source still pending admin approval may
    //     be browsed (discovery is read-only) but nothing may be imported/activated from
    //     it until an admin has reviewed and approved it.
    if (source.status === "pending-approval")
    {
      res.status(409).json({ error: "Source is pending approval — approve it before importing.", code: "SOURCE_PENDING_APPROVAL" });
      return;
    }

    // 2. Run the curated import through the injected Obot client; the core validates
    //    inputs, checks SSRF, and refuses to re-host packaged servers.
    try
    {
      const result = await _ImportRegistryServer(
        _buildImportPersistence(prisma),
        {
          sourceId: req.params.id,
          registrySource: source.originUrl,
          obotCatalogId: String(body.obotCatalogId ?? ""),
          upstreamName: String(body.upstreamName ?? ""),
          displayName: typeof body.displayName === "string" ? body.displayName : undefined,
          pinnedVersion: String(body.pinnedVersion ?? ""),
          remoteUrl: String(body.remoteUrl ?? ""),
          remoteTransport: body.remoteTransport === "sse" ? "sse" : "streamable-http",
          digest: typeof body.digest === "string" ? body.digest : undefined,
          publisher: typeof body.publisher === "string" ? body.publisher : undefined,
          repository: body.repository,
          versionId: typeof body.versionId === "string" ? body.versionId : undefined,
          publishedAt: typeof body.publishedAt === "string" ? body.publishedAt : undefined,
        },
        obotClient,
      );

      // 3. Audit the import (an explicit admin mutation) and return the stable ids.
      await (prisma as unknown as {
        auditEntry: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
      }).auditEntry.create({
        data: {
          action: "Imported",
          resource: `ThirdPartySourceItem/${result.itemId}`,
          message: `Imported ${body.upstreamName} @ ${result.pinnedVersion} as Obot catalog entry ${result.obotEntryId}`,
        },
      });

      res.status(201).json(result);
    }
    catch (err)
    {
      _sendImportError(res, err);
    }
  });

  /**
   * Re-check a previously imported entry against upstream and record whether an
   * update is available or the upstream was removed. NEVER upgrades, deletes,
   * grants, or activates — it only records an observed state for an admin to act on.
   */
  router.post("/:id/items/:itemId/check-updates", _RequireOrgAdmin(), async function _checkItemUpdates(req: Request<{ id: string; itemId: string }>, res)
  {
    // 1. Load the item and confirm it is an imported Obot catalog entry.
    const item = await (prisma as unknown as {
      thirdPartySourceItem: {
        findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
      };
    }).thirdPartySourceItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || String(item.sourceId) !== req.params.id)
    {
      res.status(404).json({ error: "Imported item not found", code: "IMPORT_ITEM_NOT_FOUND" });
      return;
    }
    const metadata = _asImportMetadata(item.metadata);
    if (metadata === undefined)
    {
      res.status(409).json({ error: "Item is not an imported Obot catalog entry", code: "NOT_AN_IMPORT" });
      return;
    }

    // 2. Resolve the registry URL and observe the current upstream snapshot.
    const source = await _loadSourceRegistryUrl(prisma, req.params.id, res);
    if (source === undefined)
    {
      return;
    }
    const pinnedVersion = typeof item.version === "string" ? item.version : "";
    const pinnedDigest = typeof item.digest === "string" ? item.digest : undefined;
    let snapshot = { present: false as boolean, version: undefined as string | undefined, digest: undefined as string | undefined };
    try
    {
      const detail = await _GetRegistryServerDetail({ baseUrl: source.originUrl, upstreamName: String(item.upstreamId) });
      snapshot = { present: true, version: detail.version, digest: detail.digest };
    }
    catch (err)
    {
      // Only an authoritative 404 means the upstream was removed (→ present:false,
      // surfaced as "removed-upstream", never a silent delete). Any other registry
      // failure is non-authoritative: report it and leave the recorded state intact.
      if (err instanceof RegistryUnavailableError && err.status === 404)
      {
        snapshot = { present: false, version: undefined, digest: undefined };
      }
      else
      {
        _sendRegistryError(res, err);
        return;
      }
    }

    // 3. Compute the reconciliation state (pure) and persist it without mutating Obot.
    const syncState = _ComputeImportSyncState({ version: pinnedVersion, digest: pinnedDigest }, snapshot);
    const nextMetadata: ImportedItemMetadata = {
      ...metadata,
      syncState,
      observedUpstreamVersion: snapshot.version,
      observedUpstreamDigest: snapshot.digest,
    };
    await (prisma as unknown as {
      thirdPartySourceItem: {
        update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
      };
    }).thirdPartySourceItem.update({
      where: { id: req.params.itemId },
      data: { metadata: nextMetadata as unknown as Record<string, unknown> },
    });

    res.json({ itemId: req.params.itemId, syncState, observedUpstreamVersion: snapshot.version, observedUpstreamDigest: snapshot.digest });
  });

  return router;
}

/**
 * Load a source and return its validated registry origin URL, writing the error
 * response and returning `undefined` when the source is missing, the wrong kind, or
 * the URL is unsafe to dial.
 *
 * @param prisma - Prisma client.
 * @param id - Source id.
 * @param res - Express response used to emit an error when validation fails.
 * @returns The source with a safe `originUrl`, or `undefined` when handled.
 */
async function _loadSourceRegistryUrl(prisma: PrismaClient, id: string, res: { status: (code: number) => { json: (body: unknown) => void } }): Promise<{ originUrl: string; status: string } | undefined>
{
  // 1. Fetch the source; a missing source is a 404.
  const source = await (prisma as unknown as {
    thirdPartySource: { findUnique: (args: { where: { id: string } }) => Promise<Record<string, unknown> | null> };
  }).thirdPartySource.findUnique({ where: { id } });
  if (!source)
  {
    res.status(404).json({ error: "Third-party source not found", code: "THIRD_PARTY_SOURCE_NOT_FOUND" });
    return undefined;
  }

  // 2. Only mcp-registry sources support live discovery/import.
  if (String(source.kind) !== "McpRegistry")
  {
    res.status(409).json({ error: "Source is not an MCP registry", code: "SOURCE_NOT_A_REGISTRY" });
    return undefined;
  }

  // 3. SSRF-validate the configured registry base URL before any fetch.
  const originUrl = String(source.originUrl);
  try
  {
    _AssertSafeRemoteUrl(originUrl);
  }
  catch (err)
  {
    if (err instanceof UnsafeRemoteUrlError)
    {
      res.status(400).json({ error: err.message, code: err.code });
      return undefined;
    }
    throw err;
  }

  return { originUrl, status: String(source.status) };
}

/**
 * Build the import persistence port over a Prisma client (idempotent item upsert).
 *
 * @param prisma - Prisma client.
 * @returns The persistence port used by {@link _ImportRegistryServer}.
 */
function _buildImportPersistence(prisma: PrismaClient): ImportPersistencePort
{
  return {
    persistImportedItem: async function _persistImportedItem(args)
    {
      const item = await (prisma as unknown as {
        thirdPartySourceItem: {
          upsert: (a: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<{ id: string }>;
        };
      }).thirdPartySourceItem.upsert({
        where: { sourceId_kind_upstreamId: { sourceId: args.sourceId, kind: "McpServer", upstreamId: args.upstreamName } },
        create: {
          sourceId: args.sourceId,
          kind: "McpServer",
          name: args.name,
          upstreamId: args.upstreamName,
          version: args.pinnedVersion,
          digest: args.digest,
          metadata: args.metadata as unknown as Record<string, unknown>,
        },
        update: {
          name: args.name,
          version: args.pinnedVersion,
          digest: args.digest,
          metadata: args.metadata as unknown as Record<string, unknown>,
        },
      });
      return { id: item.id };
    },
  };
}

/**
 * Narrow a persisted `metadata` value to imported-entry metadata.
 *
 * @param value - Raw metadata column value.
 * @returns The typed metadata, or `undefined` when it is not an import blob.
 */
function _asImportMetadata(value: unknown): ImportedItemMetadata | undefined
{
  if (typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "obot-catalog-import")
  {
    return value as ImportedItemMetadata;
  }
  return undefined;
}

/**
 * Map a discovery/registry error to an HTTP response.
 *
 * @param res - Express response.
 * @param err - The thrown error.
 */
function _sendRegistryError(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown): void
{
  if (err instanceof UnsafeRemoteUrlError)
  {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof RegistryUnavailableError)
  {
    res.status(502).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: "Discovery failed", code: "DISCOVERY_FAILED" });
}

/**
 * Map a curated-import error to an HTTP response, surfacing an unconfigured Obot
 * adapter as an actionable 503 rather than a fake success.
 *
 * @param res - Express response.
 * @param err - The thrown error.
 */
function _sendImportError(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown): void
{
  if (err instanceof ObotClientNotConfiguredError)
  {
    res.status(503).json({ error: err.message, code: "OBOT_NOT_CONFIGURED" });
    return;
  }
  if (err instanceof UnsafeRemoteUrlError)
  {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof RegistryImportValidationError)
  {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof RegistryUnavailableError)
  {
    res.status(502).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: "Import failed", code: "IMPORT_FAILED" });
}

/**
 * Map a raw third-party source record to the UI response shape.
 *
 * @param source - Raw persisted source record.
 * @returns JSON response payload.
 */
function _MapThirdPartySource(source: Record<string, unknown>): ThirdPartySource
{
  const items = Array.isArray(source.items) ? source.items as Array<Record<string, unknown>> : [];

  return {
    id: String(source.id),
    name: String(source.name),
    kind: String(source.kind).replace("McpRegistry", "mcp-registry").replace("AnthropicSkills", "anthropic-skills").replace("GitRepository", "git-repository").replace("ManualUpload", "manual-upload").toLowerCase() as ThirdPartySource["kind"],
    status: String(source.status).replace("PendingApproval", "pending-approval").toLowerCase() as ThirdPartySource["status"],
    originUrl: String(source.originUrl),
    syncMode: String(source.syncMode) as ThirdPartySource["syncMode"],
    managedItemCount: items.length,
    lastSyncedAt: source.lastSyncedAt instanceof Date ? source.lastSyncedAt.toISOString() : undefined,
    nextRunAt: source.nextRunAt instanceof Date ? source.nextRunAt.toISOString() : undefined,
    notes: typeof source.notes === "string" ? source.notes : undefined,
    items: items.map(function _mapItem(item): ThirdPartySourceItem
    {
      return {
        id: typeof item.id === "string" ? item.id : undefined,
        kind: String(item.kind).replace("McpServer", "mcp-server").replace("SkillBundle", "skill-bundle").toLowerCase() as ThirdPartySourceItem["kind"],
        name: String(item.name),
        upstreamId: String(item.upstreamId),
        version: typeof item.version === "string" ? item.version : undefined,
        digest: typeof item.digest === "string" ? item.digest : undefined,
        metadata: typeof item.metadata === "object" && item.metadata !== null ? item.metadata as Record<string, unknown> : undefined,
      };
    }),
  };
}
