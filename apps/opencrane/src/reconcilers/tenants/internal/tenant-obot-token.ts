import { Buffer } from "node:buffer";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";

import { __K8sApplyResource, _K8sDeleteResource } from "@opencrane/infra/api";
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

    // 1. Idempotency — the token is minted once and never rotated automatically (mirrors
    //    TenantEncryptionKeys), so a present Secret is authoritative and re-mint is skipped.
    if (await this._tokenSecretExists(namespace, name))
    {
      this.log.debug({ name, secretName }, "obot client token secret already exists");
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

    // 4. Persist — store the write-only bearer secret (mounted into the pod) and the
    //    revocable tokenId (used only for teardown/rotation, never mounted) in one Secret.
    await this._writeTokenSecret(namespace, name, minted.tokenId, minted.secret);
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
    // 1. Revoke — read the persisted tokenId (never the secret) and invalidate it Obot-side.
    //    Best-effort: a not-yet-wired adapter or a transient revoke failure must not block the
    //    Secret deletion below, so both are logged and swallowed.
    const tokenId = await this._readTokenId(namespace, name);
    if (tokenId)
    {
      try
      {
        await this.client.revokeClientToken(tokenId);
        this.log.info({ name }, "revoked per-tenant obot client token");
      }
      catch (err)
      {
        if (err instanceof ObotClientNotConfiguredError)
        {
          this.log.debug({ name }, "obot client token revoke skipped: obot management not configured");
        }
        else
        {
          this.log.warn({ err, name }, "obot client token revoke failed; deleting secret anyway");
        }
      }
    }

    // 2. Delete — remove the per-tenant token Secret (it holds a revocable credential, so it
    //    is not retained the way the encryption-key Secret is).
    await _K8sDeleteResource(this.objectApi, {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: _ObotClientTokenSecretName(name), namespace },
    }, this.log);
  }

  /** True when the tenant's token Secret exists and carries a mountable `token` value. */
  private async _tokenSecretExists(namespace: string, tenantName: string): Promise<boolean>
  {
    try
    {
      const secret = await this.coreApi.readNamespacedSecret({ name: _ObotClientTokenSecretName(tenantName), namespace });
      return Boolean(secret.data?.["token"]);
    }
    catch
    {
      return false;
    }
  }

  /** Read the persisted, revocable Obot tokenId from the token Secret, or `""` if absent. */
  private async _readTokenId(namespace: string, tenantName: string): Promise<string>
  {
    try
    {
      const secret = await this.coreApi.readNamespacedSecret({ name: _ObotClientTokenSecretName(tenantName), namespace });
      const encoded = secret.data?.["tokenId"];
      return encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
    }
    catch
    {
      return "";
    }
  }

  /** Write the per-tenant token Secret (create-or-replace): write-only secret + revocable tokenId. */
  private async _writeTokenSecret(namespace: string, tenantName: string, tokenId: string, secret: string): Promise<void>
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
      },
    };

    await __K8sApplyResource(this.objectApi, body, this.log);
  }
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
