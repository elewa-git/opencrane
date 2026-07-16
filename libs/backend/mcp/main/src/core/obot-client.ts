import type { ObotManagementClient } from "./obot-client.types.js";

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
