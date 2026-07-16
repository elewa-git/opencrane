import { _BuildObotClient } from "@opencrane/backend/mcp";
import type { ObotManagementClient } from "@opencrane/backend/mcp";

import { _AssertSafeRemoteUrl } from "./ssrf.js";
import type { ImportPersistencePort, ImportRegistryServerParams, ImportRegistryServerResult, ImportSyncState, ImportedItemMetadata, UpstreamSnapshot } from "./registry-import.types.js";

/**
 * The curated import action (folded #218) and its reconciliation helper.
 *
 * Import is the ONE mutation in the discovery→review→import flow: it takes a single
 * admin-chosen, pinned upstream version and writes it into Obot as a local catalog
 * entry via the injected {@link ObotManagementClient}. It never re-hosts a workload
 * (registry records are streamable-http remotes → the entry is `runtime: remote`),
 * never auto-activates or grants access, and surfaces an unconfigured Obot adapter
 * as an actionable fail-closed error rather than a fake success.
 */

/** Thrown when import inputs are invalid or the runtime claim is unsupported. */
export class RegistryImportValidationError extends Error
{
  /** Machine-stable code surfaced to API clients for branching. */
  public readonly code = "REGISTRY_IMPORT_INVALID";

  /**
   * @param reason - Human-readable reason the import was rejected.
   */
  constructor(reason: string)
  {
    super(`Registry import rejected: ${reason}`);
    this.name = "RegistryImportValidationError";
  }
}

/**
 * Import a chosen, pinned upstream server as a local Obot catalog entry.
 *
 * @param persistence - Port used to record the imported item (adapts Prisma).
 * @param params - The chosen upstream identity, pinned version, and remote URL.
 * @param client - Obot management client; defaults to the fail-closed factory so
 *   an unconfigured environment surfaces an actionable error, never a fake handle.
 * @returns The persisted item id plus the stable Obot ids and provenance.
 */
export async function _ImportRegistryServer(persistence: ImportPersistencePort, params: ImportRegistryServerParams, client: ObotManagementClient = _BuildObotClient()): Promise<ImportRegistryServerResult>
{
  // 1. Validate inputs — import ALWAYS pins, so a missing version fails closed
  //    rather than silently tracking a moving upstream.
  const pinnedVersion = params.pinnedVersion?.trim();
  if (!pinnedVersion)
  {
    throw new RegistryImportValidationError("a pinned version is required (import never tracks a moving upstream)");
  }
  if (!params.upstreamName?.trim())
  {
    throw new RegistryImportValidationError("upstream server name is required");
  }

  // 2. Validate the runtime claim — only a streamable-http/sse remote can become a
  //    pinned remote entry; a packaged server would mean re-hosting, which we refuse.
  if (params.remoteTransport !== "streamable-http" && params.remoteTransport !== "sse")
  {
    throw new RegistryImportValidationError(`unsupported runtime "${String(params.remoteTransport)}" (only remote streamable-http/sse records are importable; packaged servers are not re-hosted)`);
  }

  // 3. SSRF-validate the remote URL BEFORE the adapter is asked to dial it; an
  //    unsafe/private/non-https target is rejected here (throws UnsafeRemoteUrlError).
  const safeUrl = _AssertSafeRemoteUrl(params.remoteUrl);

  // 4. Import into Obot through the adapter. If Obot is unconfigured the adapter
  //    throws ObotClientNotConfiguredError, which propagates as an actionable
  //    fail-closed error — no local item is written for a fake success.
  const entryRef = await client.upsertCatalogEntry({
    catalogId: params.obotCatalogId,
    name: params.displayName ?? params.upstreamName,
    remoteUrl: safeUrl.toString(),
    pinnedVersion,
    digest: params.digest,
  });

  // 5. Persist provenance + stable ids only after Obot confirms the entry, so the
  //    local record can never point at an entry Obot does not have.
  const metadata: ImportedItemMetadata = {
    kind: "obot-catalog-import",
    obotCatalogId: entryRef.catalogId,
    obotEntryId: entryRef.entryId,
    remoteUrl: safeUrl.toString(),
    syncState: "in-sync",
    provenance: {
      registrySource: params.registrySource,
      publisher: params.publisher,
      repository: params.repository,
      versionId: params.versionId,
      publishedAt: params.publishedAt,
      remoteTransport: params.remoteTransport,
    },
  };
  const persisted = await persistence.persistImportedItem({
    sourceId: params.sourceId,
    upstreamName: params.upstreamName,
    name: params.displayName ?? params.upstreamName,
    pinnedVersion: entryRef.pinnedVersion ?? pinnedVersion,
    digest: entryRef.digest ?? params.digest,
    metadata,
  });

  return {
    itemId: persisted.id,
    obotCatalogId: entryRef.catalogId,
    obotEntryId: entryRef.entryId,
    pinnedVersion: entryRef.pinnedVersion ?? pinnedVersion,
    digest: entryRef.digest ?? params.digest,
    syncState: "in-sync",
  };
}

/**
 * Compute the reconciliation state of a pinned entry against an upstream snapshot.
 *
 * This is intentionally pure and side-effect free: it NEVER upgrades, deletes,
 * grants, or activates. Upstream removal → `removed-upstream`; a changed
 * version/digest → `update-available`; otherwise `in-sync`. The caller records the
 * state so an admin can decide, and a moving upstream can never silently mutate a
 * pinned local entry.
 *
 * @param pinned - The pinned version/digest recorded at import.
 * @param upstream - The freshly observed upstream snapshot.
 * @returns The reconciliation state to record.
 */
export function _ComputeImportSyncState(pinned: { version: string; digest?: string }, upstream: UpstreamSnapshot): ImportSyncState
{
  // 1. A removed upstream is surfaced, never acted on (no silent delete).
  if (!upstream.present)
  {
    return "removed-upstream";
  }

  // 2. A changed pinned version means a new release exists upstream.
  if (upstream.version !== undefined && upstream.version !== pinned.version)
  {
    return "update-available";
  }

  // 3. A changed digest at the same version means the upstream content moved.
  if (pinned.digest !== undefined && upstream.digest !== undefined && upstream.digest !== pinned.digest)
  {
    return "update-available";
  }

  return "in-sync";
}
