import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";

import { __K8sApplyResource, _K8sDeleteResource, _IsNotFound } from "@opencrane/infra/api";
import { _BuildObotClient, ObotClientNotConfiguredError, type ObotManagementClient } from "@opencrane/backend/mcp";
import { _BuildTenantLabels } from "../deploy/tenant-labels.js";
import type { Tenant } from "../models/tenant.interface.js";

/**
 * Manages the per-tenant Obot API token that authorises a tenant pod against the Obot
 * MCP gateway (issue #128).
 *
 * Why this exists: the tenant pod historically mounted a projected `obot-gateway`
 * Kubernetes service-account token, but Obot v0.23.1 does not validate k8s TokenReview
 * tokens — that credential was never a working Obot bearer. This helper replaces it with a
 * REAL, per-tenant Obot API token minted through the Obot management adapter
 * ({@link ObotManagementClient.mintClientToken}) and stored in a dedicated per-tenant
 * Secret the pod mounts as a file.
 *
 * Design decisions:
 * - The token is minted once on first reconcile and never rotated automatically (mirrors
 *   {@link TenantEncryptionKeys}); the {@link revokeAndDeleteObotClientToken} primitive
 *   is the seam a future rotation/credential-change flow reuses.
 * - Only the write-only bearer `secret` is projected into the pod (as the `token` key); the
 *   revocable `tokenId` is persisted alongside it in the same Secret so teardown can revoke
 *   it, but is NEVER mounted, logged, serialised in an API response, or written to a DB column.
 * - Fail-closed: until live Obot management is wired (Wave 3) the adapter's mint call throws
 *   {@link ObotClientNotConfiguredError}. That is handled here as "not ready" — NO fake token
 *   is written and the caller omits the credential mount — rather than minting a placeholder.
 */
export class TenantObotToken
{
  /** Client for core Kubernetes API operations (Secret reads). */
  private coreApi: k8s.CoreV1Api;

  /** Client for generic Kubernetes object CRUD via server-side apply/delete. */
  private objectApi: k8s.KubernetesObjectApi;

  /** Scoped logger for Obot client-token lifecycle events. */
  private log: Logger;

  /** Obot management adapter used to mint/revoke per-tenant API tokens. */
  private client: ObotManagementClient;

  /**
   * Create a new TenantObotToken helper bound to the operator dependencies.
   *
   * @param coreApi - Core Kubernetes API client used to read the token Secret.
   * @param objectApi - Generic Kubernetes object client used to apply/delete the Secret.
   * @param log - Scoped logger.
   * @param client - Obot management adapter; defaults to {@link _BuildObotClient} (the
   *   fail-closed no-op until Wave 3), overridable for tests.
   */
  constructor(
    coreApi: k8s.CoreV1Api,
    objectApi: k8s.KubernetesObjectApi,
    log: Logger,
    client: ObotManagementClient = _BuildObotClient(),
  )
  {
    this.coreApi = coreApi;
    this.objectApi = objectApi;
    this.log = log;
    this.client = client;
  }

  /**
   * Ensure the tenant has a per-tenant Obot client-token Secret and report whether the pod
   * can mount it.
   *
   * Idempotent: an existing token Secret is left untouched (mint-once) and reported ready.
   * When the Secret is absent, a token is minted through the Obot adapter and persisted.
   *
   * Fail-closed: if the adapter is not yet wired to a live Obot ({@link
   * ObotClientNotConfiguredError}) the mint is skipped, NO token is written, and `false` is
   * returned so the caller omits the credential mount (the pod comes up without an
   * MCP-gateway credential rather than with a fake one). Any other error is re-thrown so the
   * reconcile fails loudly.
   *
   * @param tenant - The Tenant CR being reconciled.
   * @param namespace - Namespace the token Secret is written to.
   * @returns `true` when the token Secret is present and mountable, `false` when fail-closed.
   */
  async ensureObotClientTokenSecret(tenant: Tenant, namespace: string): Promise<boolean>
  {
    const name = tenant.metadata!.name!;
    const secretName = _ObotClientTokenSecretName(name);

    // 1. Read the existing token Secret. A 404 means "mint one"; any OTHER k8s error
    //    (authorization failure, timeout) MUST NOT be mistaken for absence — that would
    //    mint a duplicate token — so `_readTokenSecret` rethrows it and the reconcile
    //    retries. An unexpired token is authoritative (mint-once); an expired one rotates.
    const existing = await this._readTokenSecret(namespace, name);
    if (existing && existing.token && !_IsExpired(existing.expiresAt))
    {
      this.log.debug({ name, secretName }, "obot client token secret already exists and is unexpired");
      return true;
    }

    // 2. Owner identity — the Obot user the token is owned by is the pod's authenticated
    //    identity: the IdP subject when present, else the owner email (lower-cased to match
    //    the gateway trusted-proxy allowlist normalisation).
    const ownerObotUserId = tenant.spec.subject?.trim() || tenant.spec.email.trim().toLowerCase();

    // 3. Mint — fail-closed while the adapter is the no-op: a NotConfigured error means Obot
    //    management is not wired yet, so report not-ready WITHOUT writing a placeholder token.
    let minted;
    try
    {
      minted = await this.client.mintClientToken({ ownerObotUserId, tenant: name });
    }
    catch (err)
    {
      if (err instanceof ObotClientNotConfiguredError)
      {
        // TODO(Wave 3): once _BuildObotClient returns the live HTTP client this branch is no
        // longer reached — the mint succeeds and the credential mount appears. Until then the
        // pod runs without an MCP-gateway credential rather than a fabricated one.
        this.log.warn({ name }, "obot client token not minted: obot management not configured (fail-closed, credential mount omitted)");
        return false;
      }
      throw err;
    }

    // 4. Persist — store the write-only bearer secret (mounted into the pod), the revocable
    //    tokenId, and the expiry. If persistence FAILS the freshly-minted token would remain
    //    active with no stored revocation handle, so revoke it (best-effort) before rethrowing.
    try
    {
      await this._writeTokenSecret(namespace, name, minted.tokenId, minted.secret, minted.expiresAt);
    }
    catch (err)
    {
      await this._revokeQuietly(minted.tokenId, name, "compensating for token-secret persistence failure");
      throw err;
    }

    // 5. Rotation cleanup — if we replaced an expired token, revoke the old one Obot-side
    //    (best-effort; its Secret entry has already been overwritten).
    if (existing?.tokenId)
    {
      await this._revokeQuietly(existing.tokenId, name, "rotating expired obot client token");
    }

    this.log.info({ name, secretName }, "minted per-tenant obot client token");
    return true;
  }

  /**
   * Revoke the tenant's Obot client token (best-effort) and delete its Secret.
   *
   * Called on teardown. The persisted `tokenId` is read back and passed to the adapter's
   * revoke route so the credential is invalidated Obot-side; a NotConfigured adapter (Obot
   * not wired) or any revoke error is logged and swallowed so cleanup still removes the
   * Secret. Unlike the encryption-key Secret (retained for data recovery), the token Secret
   * carries a revocable credential and is removed.
   *
   * @param name - The tenant CR name.
   * @param namespace - Namespace the token Secret lives in.
   */
  async revokeAndDeleteObotClientToken(name: string, namespace: string): Promise<void>
  {
    // 1. Read the persisted tokenId (never the secret). A 404 means the Secret is already
    //    gone (nothing to do); any OTHER read error is rethrown so cleanup retries rather
    //    than deleting blindly.
    const existing = await this._readTokenSecret(namespace, name);
    if (!existing)
    {
      return;
    }

    // 2. Revoke Obot-side. If the adapter isn't wired (NotConfigured) there is nothing to
    //    revoke, so proceed to delete. On any OTHER revoke failure, DO NOT delete the Secret:
    //    it holds the only revocation handle, so we retain it and rethrow so a later reconcile
    //    retries — the token id is never discarded until revocation succeeds.
    if (existing.tokenId)
    {
      try
      {
        await this.client.revokeClientToken(existing.tokenId);
        this.log.info({ name }, "revoked per-tenant obot client token");
      }
      catch (err)
      {
        if (!(err instanceof ObotClientNotConfiguredError))
        {
          this.log.warn({ err, name }, "obot client token revoke failed; retaining secret (revocation-pending) for retry");
          throw err;
        }
        this.log.debug({ name }, "obot client token revoke skipped: obot management not configured");
      }
    }

    // 3. Delete — only after a successful (or nothing-to-revoke) revocation. The Secret holds
    //    a revocable credential, so it is not retained the way the encryption-key Secret is.
    await _K8sDeleteResource(this.objectApi, {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: _ObotClientTokenSecretName(name), namespace },
    }, this.log);
  }

  /**
   * Read the token Secret's decoded fields, or `null` when it genuinely does not exist.
   *
   * Only a 404 is treated as absent; every other error (authorization, timeout) is rethrown
   * so a transient read failure is never mistaken for "no token" (which would mint a duplicate
   * or delete without revoking).
   *
   * @param namespace - Namespace the Secret lives in.
   * @param tenantName - The tenant CR name.
   * @returns The decoded `{ token, tokenId, expiresAt }`, or null on 404.
   */
  private async _readTokenSecret(namespace: string, tenantName: string): Promise<{ token: string; tokenId: string; expiresAt: string } | null>
  {
    try
    {
      const secret = await this.coreApi.readNamespacedSecret({ name: _ObotClientTokenSecretName(tenantName), namespace });
      const decode = function _decode(key: string): string { const v = secret.data?.[key]; return v ? Buffer.from(v, "base64").toString("utf8") : ""; };
      return { token: decode("token"), tokenId: decode("tokenId"), expiresAt: decode("expiresAt") };
    }
    catch (err)
    {
      if (_IsNotFound(err))
      {
        return null;
      }
      throw err;
    }
  }

  /** Revoke a token Obot-side, swallowing errors — for compensation + rotation cleanup. */
  private async _revokeQuietly(tokenId: string, name: string, reason: string): Promise<void>
  {
    try
    {
      await this.client.revokeClientToken(tokenId);
      this.log.info({ name }, `revoked obot client token: ${reason}`);
    }
    catch (err)
    {
      if (!(err instanceof ObotClientNotConfiguredError))
      {
        this.log.warn({ err, name }, `obot client token revoke failed: ${reason}`);
      }
    }
  }

  /** Write the per-tenant token Secret (create-or-replace): write-only secret + tokenId + expiry. */
  private async _writeTokenSecret(namespace: string, tenantName: string, tokenId: string, secret: string, expiresAt?: string): Promise<void>
  {
    const body: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: _ObotClientTokenSecretName(tenantName),
        namespace,
        labels: _BuildTenantLabels(tenantName),
      },
      type: "Opaque",
      data: {
        token: Buffer.from(secret).toString("base64"),
        tokenId: Buffer.from(tokenId).toString("base64"),
        ...(expiresAt ? { expiresAt: Buffer.from(expiresAt).toString("base64") } : {}),
      },
    };

    await __K8sApplyResource(this.objectApi, body, this.log);
  }
}

/**
 * Whether a stored token expiry has passed. An empty/absent expiry means a non-expiring
 * token (ready indefinitely); a malformed value is treated as non-expiring rather than
 * forcing a rotation storm.
 *
 * @param expiresAt - The stored ISO expiry string (or "" when none).
 * @returns True only when a parseable expiry is in the past.
 */
function _IsExpired(expiresAt: string): boolean
{
  if (!expiresAt)
  {
    return false;
  }
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at <= Date.now();
}

/**
 * The per-tenant Secret name carrying this tenant's Obot client token (`token` field mounted
 * into the pod; `tokenId` field retained for revoke), consumed by `_BuildDeployment`.
 *
 * @param tenantName - The tenant CR name.
 * @returns The Secret name (`openclaw-<name>-obot-client-token`).
 */
export function _ObotClientTokenSecretName(tenantName: string): string
{
  return `openclaw-${tenantName}-obot-client-token`;
}
