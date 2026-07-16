import type {
  ObotCatalogEntryRef,
  ObotClientToken,
  ObotConfigureServerParams,
  ObotCreateServerParams,
  ObotMintTokenParams,
  ObotReconcileAccessParams,
  ObotServerRef,
  ObotServerState,
  ObotToolDescriptor,
  ObotUpsertCatalogEntryParams,
} from "./obot-client.types.js";

/**
 * Authenticated Obot v0.23.1 management + runtime client (italanta/opencrane#128).
 *
 * Every method maps to a real Obot route, so an OpenCrane endpoint can never report
 * "connected"/"configured" without a successful Obot operation. The live HTTP
 * implementation (timeouts, retries, tracing, redaction, contract tests pinned to
 * recorded v0.23.1 fixtures) lands in Wave 1.A behind this interface; the operator
 * and servers logic drive it through the mockable seam below.
 */
export interface ObotManagementClient
{
  /**
   * Import/create a pinned catalog entry (folded #218 curated import). Idempotent
   * on (catalogId, remoteUrl, pinnedVersion) so a retried import repairs rather than
   * duplicates. Discovery is read-only elsewhere; this is the only import mutation.
   * @param params - Catalog, name, pinned remote URL + version, and provenance.
   */
  upsertCatalogEntry(params: ObotUpsertCatalogEntryParams): Promise<ObotCatalogEntryRef>;

  /**
   * Deploy a server for a catalog entry in personal (singleUser) or shared
   * (multiUser) mode. Idempotent per (entry, mode, owner) and repairable after a
   * partial failure.
   * @param params - Entry ref, deployment mode, and owning Obot user for singleUser.
   */
  createServer(params: ObotCreateServerParams): Promise<ObotServerRef>;

  /**
   * Configure write-only credential material on a server. The material is streamed
   * straight to Obot and never returned; readiness comes back derived from Obot.
   * @param params - The server ref and the write-only secret map.
   */
  configureServer(params: ObotConfigureServerParams): Promise<ObotServerState>;

  /**
   * Fetch Obot's live state for a server/instance (readiness, connect URL,
   * transport, missing headers, error) for projection into OpenCrane.
   * @param server - The server/instance to read.
   */
  getServerState(server: ObotServerRef): Promise<ObotServerState>;

  /**
   * Reconcile the FULL desired access-rule set for a resource so OpenCrane intent is
   * the single authority and Obot is the enforcement point. Empty desired set ⇒
   * default-deny.
   * @param params - Catalog, resource id, and the complete desired rule set.
   */
  reconcileAccess(params: ObotReconcileAccessParams): Promise<void>;

  /**
   * List the tools Obot advertises for a configured server (runtime `tools/list`).
   * @param server - The configured server to enumerate.
   */
  listTools(server: ObotServerRef): Promise<ObotToolDescriptor[]>;

  /**
   * Delete/deconfigure a server and clear its credential custody in Obot.
   * @param server - The server/instance to remove.
   */
  deleteServer(server: ObotServerRef): Promise<void>;

  /**
   * Mint a per-tenant Obot client token for an OpenClaw identity (#128 decision:
   * replaces the unused projected `obot-gateway` k8s SA token). The secret is
   * write-only — handed to the pod provisioning path, never persisted or logged.
   * @param params - Owning Obot user id and tenant context.
   */
  mintClientToken(params: ObotMintTokenParams): Promise<ObotClientToken>;

  /**
   * Revoke a previously minted per-tenant Obot client token.
   * @param tokenId - The `ObotClientToken.tokenId` to revoke.
   */
  revokeClientToken(tokenId: string): Promise<void>;
}

/**
 * Error thrown by every no-op method so a caller can never mistake an unconfigured
 * adapter for a successful Obot operation. Simulation is gone (#128): with no live
 * Obot wired, MCP management must fail closed rather than mint a fake handle.
 */
export class ObotClientNotConfiguredError extends Error
{
  constructor(operation: string)
  {
    super(`Obot management client not configured — cannot ${operation}. Wire OBOT_MANAGEMENT_URL + credentials (Wave 1.A) before enabling live MCP management.`);
    this.name = "ObotClientNotConfiguredError";
  }
}

/**
 * Default client used until the live Obot management path is wired (Wave 1.A needs
 * a running, authenticated Obot v0.23.1 to record contract fixtures against).
 *
 * Unlike the old simulated flow, it performs NO mutation and mints NO handle — every
 * method fails closed with {@link ObotClientNotConfiguredError}. This keeps the
 * fail-closed-outside-local-dev contract: an install/credential/OAuth endpoint
 * cannot report success while the adapter is a no-op.
 */
export class _NoopObotClient implements ObotManagementClient
{
  /** @inheritdoc */
  async upsertCatalogEntry(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("import a catalog entry");
  }

  /** @inheritdoc */
  async createServer(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("create a server");
  }

  /** @inheritdoc */
  async configureServer(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("configure server credentials");
  }

  /** @inheritdoc */
  async getServerState(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("read server state");
  }

  /** @inheritdoc */
  async reconcileAccess(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("reconcile access rules");
  }

  /** @inheritdoc */
  async listTools(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("list tools");
  }

  /** @inheritdoc */
  async deleteServer(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("delete a server");
  }

  /** @inheritdoc */
  async mintClientToken(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("mint a client token");
  }

  /** @inheritdoc */
  async revokeClientToken(): Promise<never>
  {
    throw new ObotClientNotConfiguredError("revoke a client token");
  }
}

/**
 * Build the Obot management client from the environment.
 *
 * Today this always returns the fail-closed no-op: the live HTTP client depends on a
 * running, authenticated Obot v0.23.1 to record contract fixtures against (Wave 1.A).
 * The factory is the single seam to swap in the real client without touching the
 * operator/servers orchestration that consumes {@link ObotManagementClient}.
 */
export function _BuildObotClient(): ObotManagementClient
{
  return new _NoopObotClient();
}
