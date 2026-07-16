import type { RegistryRepository } from "./registry-discovery.types.js";

/**
 * Types for the curated import action (folded #218): an explicit admin step that
 * imports ONE chosen, pinned upstream version as a local Obot catalog entry. Import
 * is the only mutation in this flow; discovery is read-only. Import creates a pinned
 * `runtime: remote` entry (registry records are streamable-http remotes) — it never
 * claims the workload was re-hosted, and never auto-activates or grants access.
 */

/** Observed reconciliation state of a previously imported entry against upstream. */
export type ImportSyncState = "in-sync" | "update-available" | "removed-upstream";

/** Provenance persisted alongside an imported entry (stored on item metadata). */
export interface ImportedEntryProvenance
{
  /** Registry base URL the entry was imported from. */
  registrySource: string;
  /** Publisher/namespace of the upstream server, when known. */
  publisher?: string;
  /** Source repository provenance, when known. */
  repository?: RegistryRepository;
  /** Upstream registry version id at import time, when known. */
  versionId?: string;
  /** Upstream publish timestamp at import time, when known. */
  publishedAt?: string;
  /** Remote transport the pinned entry speaks. */
  remoteTransport: "streamable-http" | "sse";
}

/**
 * Metadata blob persisted on `ThirdPartySourceItem.metadata` for an imported entry.
 * Carries the stable Obot ids and provenance since no dedicated columns exist (see
 * the schema follow-up in the lane report).
 */
export interface ImportedItemMetadata
{
  /** Discriminates imported-entry metadata from other item metadata shapes. */
  kind: "obot-catalog-import";
  /** Obot catalog the entry was written into. */
  obotCatalogId: string;
  /** Stable Obot catalog-entry id returned by the adapter. */
  obotEntryId: string;
  /** Pinned remote URL the entry points at (already SSRF-validated at import). */
  remoteUrl: string;
  /** Current reconciliation state versus upstream. */
  syncState: ImportSyncState;
  /** Latest upstream version observed by a check, when it differs from the pin. */
  observedUpstreamVersion?: string;
  /** Latest upstream digest observed by a check, when it differs from the pin. */
  observedUpstreamDigest?: string;
  /** Import-time provenance. */
  provenance: ImportedEntryProvenance;
}

/** Parameters for the curated import action. */
export interface ImportRegistryServerParams
{
  /** OpenCrane `ThirdPartySource` id this import is recorded under. */
  sourceId: string;
  /** Registry base URL the chosen record came from (provenance). */
  registrySource: string;
  /** Obot catalog id to import the entry into. */
  obotCatalogId: string;
  /** Upstream canonical server name (stable identity). */
  upstreamName: string;
  /** Human-readable display name for the local entry. */
  displayName?: string;
  /** Version to pin — import always pins; a missing version fails closed. */
  pinnedVersion: string;
  /** Chosen remote URL — SSRF-validated before the adapter is called. */
  remoteUrl: string;
  /** Transport the chosen remote speaks. */
  remoteTransport: "streamable-http" | "sse";
  /** Upstream content digest to record as provenance, when known. */
  digest?: string;
  /** Publisher/namespace, when known. */
  publisher?: string;
  /** Source repository provenance, when known. */
  repository?: RegistryRepository;
  /** Upstream registry version id, when known. */
  versionId?: string;
  /** Upstream publish timestamp, when known. */
  publishedAt?: string;
}

/** Result of a successful curated import. */
export interface ImportRegistryServerResult
{
  /** OpenCrane `ThirdPartySourceItem` id created/updated for the entry. */
  itemId: string;
  /** Obot catalog the entry lives under. */
  obotCatalogId: string;
  /** Stable Obot catalog-entry id. */
  obotEntryId: string;
  /** The pinned version recorded on the entry. */
  pinnedVersion: string;
  /** The digest recorded on the entry, when known. */
  digest?: string;
  /** Reconciliation state the entry starts in (always in-sync on fresh import). */
  syncState: ImportSyncState;
}

/** The upstream snapshot compared against a pinned entry during an update check. */
export interface UpstreamSnapshot
{
  /** Whether the upstream record still exists in the registry. */
  present: boolean;
  /** Latest upstream version, when the record is present. */
  version?: string;
  /** Latest upstream digest, when present and exposed. */
  digest?: string;
}

/** Arguments handed to the persistence port when recording an imported entry. */
export interface PersistImportedItemArgs
{
  /** `ThirdPartySource` id the item belongs to. */
  sourceId: string;
  /** Upstream canonical server name (the item's `upstreamId`). */
  upstreamName: string;
  /** Human-readable item name. */
  name: string;
  /** Pinned version recorded on the item. */
  pinnedVersion: string;
  /** Digest recorded on the item, when known. */
  digest?: string;
  /** Structured metadata blob (Obot ids + provenance + sync state). */
  metadata: ImportedItemMetadata;
}

/**
 * Narrow persistence port the import action writes through. The route adapts a
 * Prisma client to this so the core import logic is unit-testable against a mock
 * (no Prisma engine needed) and the SSRF/adapter contract is exercised in isolation.
 */
export interface ImportPersistencePort
{
  /**
   * Upsert the `ThirdPartySourceItem` for an imported entry (idempotent on
   * source + kind + upstream id) and return its id.
   * @param args - The item fields to persist.
   */
  persistImportedItem(args: PersistImportedItemArgs): Promise<{ id: string }>;
}
