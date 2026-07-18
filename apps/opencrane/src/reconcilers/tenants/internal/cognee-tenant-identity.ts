import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";

import type { OpenClawTenantOperatorConfig } from "../../../app/config.js";
import { __K8sApplyResource } from "@opencrane/infra/api";
import { _BuildTenantLabels } from "../deploy/tenant-labels.js";
import type { Tenant } from "../models/tenant.types.js";
import { _ReadSiloOwnerState } from "./cognee-silo-tenant.js";

/**
 * Provisions a REAL, per-openclaw-tenant Cognee user account — the tenant's pod
 * authenticates to Cognee AS THE TENANT'S OWNER, never as a shared/default identity.
 *
 * Why this exists: Cognee's `ENABLE_BACKEND_ACCESS_CONTROL` defaults on, so every request
 * needs a real user session. Left unconfigured, the official `@cognee/cognee-openclaw`
 * plugin (verified against the shipped package's `client.js`: `login()`) falls back to
 * Cognee's hardcoded default account (`default_user@example.com` / `default_password`) —
 * every tenant in the silo would then share ONE Cognee identity, which both defeats
 * Cognee's own per-user dataset access control (the actual enforcement the plugin's
 * multi-scope config in `_BuildConfigMap` relies on) and means a single well-known
 * credential exposes every tenant's memory (worse given the unpatched
 * topoteretes/cognee#3084 self-registration bug — see PR #178's egress mitigation).
 *
 * This registers the tenant's OWNER EMAIL — the SAME identity the gateway's trusted-proxy
 * `allowUsers` allowlist already pins the pod to (`_BuildConfigMap`'s `ownerEmail`), i.e.
 * the actual login the tenant's user authenticates with — as a real Cognee account with a
 * per-tenant password. `2-config-map.ts` deliberately renders NO `apiKey`/`username`/
 * `password` into the plugin's config (never put a real password into a ConfigMap); the
 * plugin falls back to reading `COGNEE_USERNAME`/`COGNEE_PASSWORD` from the pod's own
 * environment instead (verified in the shipped plugin's `config.js`), which
 * `_BuildDeployment` populates via `secretKeyRef` from the Secret this class writes. From
 * there the plugin manages its own JWT login/re-login (verified in `client.js`: it lazily
 * logs in on first request and transparently re-authenticates on a 401) — the operator
 * never has to track a token lifecycle.
 *
 * The password is NOT freshly `randomBytes`-generated on every reconcile — it is derived
 * deterministically (HMAC-SHA256) from the tenant's own encryption key (already minted by
 * `TenantEncryptionKeys` one reconcile step earlier). This makes registration crash-safe:
 * if the operator dies between the register call and writing this Secret, the next
 * reconcile derives the IDENTICAL password and retries — Cognee's register endpoint
 * returns 400 for a duplicate email, treated here as success, so the retry converges on
 * the correct credential instead of leaving an unrecoverable password mismatch.
 */
export class CogneeTenantIdentity
{
  private config: OpenClawTenantOperatorConfig;
  private coreApi: k8s.CoreV1Api;
  private objectApi: k8s.KubernetesObjectApi;
  private log: Logger;

  constructor(
    config: OpenClawTenantOperatorConfig,
    coreApi: k8s.CoreV1Api,
    objectApi: k8s.KubernetesObjectApi,
    log: Logger,
  )
  {
    this.config = config;
    this.coreApi = coreApi;
    this.objectApi = objectApi;
    this.log = log;
  }

  /**
   * Ensure the tenant has a real, dedicated Cognee login. No-ops when Cognee is not
   * configured for this silo, or when the tenant's credentials Secret already exists —
   * the login is minted once and never rotated (mirrors `TenantEncryptionKeys`).
   *
   * @param tenant - The Tenant CR being reconciled. Requires its encryption key Secret
   *        (`openclaw-<name>-encryption-key`) to already exist — call after
   *        `TenantEncryptionKeys.ensureEncryptionKeySecret` in the same reconcile pass.
   * @param namespace - Namespace the credentials Secret is written to.
   */
  async ensureTenantCogneeIdentity(tenant: Tenant, namespace: string): Promise<void>
  {
    if (!this.config.cogneeEndpoint)
    {
      return;
    }

    const name = tenant.metadata!.name!;
    const secretName = _CredentialsSecretName(name);

    // Email is the SAME identity the gateway's trusted-proxy allowlist already pins the pod to
    // (`_BuildConfigMap`'s `ownerEmail`) — "the user login" the tenant's owner authenticates with.
    // `subject` (an opaque OIDC `sub`) is deliberately NOT used: Cognee validates `email` as a real
    // email address and would reject a non-email subject string.
    const email = tenant.spec.email.trim().toLowerCase();

    // 1. Idempotency + self-heal. The login is minted once and never rotated (the password is
    //    derived deterministically), but "the Secret exists" is NOT proof the login still WORKS: a
    //    Cognee identity-store reset (a restart before persistence landed, a rebuilt instance) wipes
    //    the user while the Secret lingers, orphaning it (→ 401 on every memory write). So when the
    //    Secret is present, verify the login actually authenticates; skip only if it does. A failed
    //    login (or missing Secret) falls through to (re-)register — the deterministic password makes
    //    re-registration converge on the identical credential.
    const existing = await this._readCredentialsSecret(namespace, name);
    if (existing !== undefined && await this._loginSucceeds(existing.username, existing.password))
    {
      this.log.debug({ name, secretName }, "cognee tenant identity already exists and authenticates");
      return;
    }

    // 2. Register with Cognee. A 400 almost always means the email is already registered — since the
    //    password is derived deterministically, retrying with the identical password converges
    //    either way, so both outcomes proceed to step 3.
    const password = await this._deriveTenantPassword(name, namespace, email);
    await this._registerCogneeUser(email, password, name);

    // 3. Persist the login. `_BuildDeployment` mounts `username`/`password` as COGNEE_USERNAME/
    //    COGNEE_PASSWORD env vars (secretKeyRef); the plugin reads those directly since
    //    `2-config-map.ts` renders no username/password/apiKey. `tenantId` is reset to empty: if we
    //    reached this path the Cognee user (and thus its tenant membership) was absent, so the join
    //    step must re-run — `ensureTenantJoinedToSiloTenant` keys off this.
    await this._writeCredentialsSecret(namespace, name, { username: email, password, tenantId: "" });
    this.log.info({ name, secretName, email }, existing !== undefined ? "re-provisioned cognee tenant identity (login no longer authenticated)" : "created cognee tenant identity");
  }

  /**
   * Join this tenant's Cognee login to the silo's shared Cognee Tenant (see
   * `CogneeSiloTenant`), and make it that login's ACTIVE tenant. Without this, the tenant's
   * login has `tenant_id = NULL` and the plugin's `companyDataset` scope silently becomes a
   * private, non-shared dataset instead of the org-wide shared one — see the class doc
   * comment for the full Cognee-side mechanics.
   *
   * No-ops when: Cognee is not configured; this tenant has no credentials yet (call after
   * `ensureTenantCogneeIdentity` in the same reconcile pass); membership was already
   * resolved by a prior reconcile; or the silo's owner/Tenant isn't provisioned yet (best
   * effort — retried automatically on a later reconcile once `CogneeSiloTenant` catches up).
   *
   * @param tenant - The Tenant CR being reconciled.
   * @param namespace - Namespace both this tenant's and the silo owner's Secrets live in.
   */
  async ensureTenantJoinedToSiloTenant(tenant: Tenant, namespace: string): Promise<void>
  {
    if (!this.config.cogneeEndpoint)
    {
      return;
    }

    const name = tenant.metadata!.name!;
    const credentials = await this._readCredentialsSecret(namespace, name);
    if (credentials === undefined)
    {
      this.log.debug({ name }, "cognee tenant identity not provisioned yet; skipping silo-tenant join");
      return;
    }

    const owner = await _ReadSiloOwnerState(this.coreApi, namespace);
    if (owner === undefined || !owner.tenantId)
    {
      this.log.debug({ name }, "cognee silo owner/tenant not resolved yet; will retry joining on a later reconcile");
      return;
    }

    // Gate on membership of the CURRENT silo tenant, not merely "some tenantId is cached". A silo
    // re-provision (CogneeSiloTenant self-heal after an identity-store reset) mints a NEW owner
    // tenantId, and a wiped login has its cached tenantId reset to "" by ensureTenantCogneeIdentity
    // — both cases make the cached id differ from the owner's current one, so the (re)join below
    // runs. When they already match, the login is joined to the live silo tenant: converged.
    if (credentials.tenantId === owner.tenantId)
    {
      this.log.debug({ name }, "cognee tenant identity already joined to the current silo tenant");
      return;
    }

    const ownerToken = await this._loginCognee(owner.username, owner.password, `${name} (as silo owner)`);
    const userId = await this._getUserIdByEmail(ownerToken, credentials.username, name);
    await this._addUserToTenant(ownerToken, userId, owner.tenantId, name);

    const userToken = await this._loginCognee(credentials.username, credentials.password, name);
    await this._selectTenant(userToken, owner.tenantId, name);

    await this._writeCredentialsSecret(namespace, name, { ...credentials, tenantId: owner.tenantId });
    this.log.info({ name, tenantId: owner.tenantId }, "joined cognee tenant identity to the silo tenant");
  }

  /**
   * The Cognee silo-tenant id this tenant's login is currently joined to (from its credentials
   * Secret), or `""` when not provisioned/joined yet. The reconcile loop folds this into the tenant
   * pod's roll-checksum: the pod caches its Cognee session at start and does NOT re-login on a 401,
   * so a server-side identity heal (silo re-provisioned → new tenant id, or a wiped login
   * re-registered → id reset then re-joined) is invisible to a long-running pod until it rolls.
   * Stamping the id makes a successful (re)join change the pod template → a Recreate roll → the
   * plugin logs in fresh against the healed Cognee.
   */
  async currentJoinedTenantId(tenantName: string, namespace: string): Promise<string>
  {
    const credentials = await this._readCredentialsSecret(namespace, tenantName);
    return credentials?.tenantId ?? "";
  }

  /**
   * Register `email`/`password` as a Cognee user. Idempotent: a 400 response (Cognee's
   * signal for "email already registered", verified against the shipped `test_backend_auth.py`:
   * `assert register_response.status_code in (201, 400)`) is treated as success since the
   * password is derived deterministically and will match whatever was registered previously.
   */
  private async _registerCogneeUser(email: string, password: string, tenantName: string): Promise<void>
  {
    const response = await fetch(`${this.config.cogneeEndpoint}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (response.ok)
    {
      return;
    }

    if (response.status === 400)
    {
      const body = await response.text();
      this.log.info({ tenantName, email, body }, "cognee user already registered; adopting existing account");
      return;
    }

    const body = await response.text();
    throw new Error(`Cognee user registration failed for ${tenantName} (${response.status}): ${body}`);
  }

  /**
   * Derive a stable per-tenant Cognee password from the tenant's own encryption key
   * (already minted by `TenantEncryptionKeys` earlier in the same reconcile pass), so a
   * retry after a partial failure (see class doc comment) always reproduces the same value.
   */
  private async _deriveTenantPassword(tenantName: string, namespace: string, email: string): Promise<string>
  {
    const encryptionKeySecretName = `openclaw-${tenantName}-encryption-key`;
    const encryptionKeySecret = await this.coreApi.readNamespacedSecret({ name: encryptionKeySecretName, namespace });
    const encoded = encryptionKeySecret.data?.["key"];
    if (!encoded)
    {
      throw new Error(`${encryptionKeySecretName} Secret has no "key" field — cannot derive a stable cognee password`);
    }

    const keyBytes = Buffer.from(encoded, "base64");
    return createHmac("sha256", keyBytes).update(`cognee-tenant-identity-v1:${email}`).digest("base64url");
  }

  /** Log in to Cognee and return a bearer JWT. */
  private async _loginCognee(email: string, password: string, context: string): Promise<string>
  {
    const response = await fetch(`${this.config.cogneeEndpoint}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: email, password }),
    });

    if (!response.ok)
    {
      const body = await response.text();
      throw new Error(`Cognee login failed for ${context} (${response.status}): ${body}`);
    }

    const payload = await response.json() as { access_token?: string };
    if (!payload.access_token)
    {
      throw new Error(`Cognee login for ${context} returned no access_token`);
    }

    return payload.access_token;
  }

  /**
   * Best-effort liveness gate: does this Cognee login authenticate right now? Returns false on a
   * 401 or any error (⇒ the caller re-registers) rather than throwing. Distinct from
   * {@link _loginCognee}, which throws — this is used only to decide whether a cached credential is
   * still valid, so a transient blip conservatively re-runs the (idempotent) register path.
   */
  private async _loginSucceeds(email: string, password: string): Promise<boolean>
  {
    try
    {
      await this._loginCognee(email, password, "liveness check");
      return true;
    }
    catch
    {
      return false;
    }
  }

  /** Resolve a Cognee user's UUID from their email, authenticated as the silo owner. */
  private async _getUserIdByEmail(ownerToken: string, email: string, tenantName: string): Promise<string>
  {
    const response = await fetch(`${this.config.cogneeEndpoint}/api/v1/users/get-user-id`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ email }),
    });

    if (!response.ok)
    {
      const body = await response.text();
      throw new Error(`Cognee get-user-id failed for ${tenantName} (${response.status}): ${body}`);
    }

    const payload = await response.json() as { user_id?: string };
    if (!payload.user_id)
    {
      throw new Error(`Cognee get-user-id for ${tenantName} returned no user_id`);
    }

    return payload.user_id;
  }

  /**
   * Add `userId` to the silo's Cognee Tenant, authenticated as the silo owner (the tenant
   * owner). A 409 (Cognee's `EntityAlreadyExistsError` for "User is already part of group")
   * is treated as success — this call is safe to repeat across reconciles.
   */
  private async _addUserToTenant(ownerToken: string, userId: string, tenantId: string, tenantName: string): Promise<void>
  {
    const response = await fetch(
      `${this.config.cogneeEndpoint}/api/v1/permissions/users/${userId}/tenants?tenant_id=${tenantId}`,
      { method: "POST", headers: { Authorization: `Bearer ${ownerToken}` } },
    );

    if (response.ok || response.status === 409)
    {
      return;
    }

    const body = await response.text();
    throw new Error(`Cognee add-user-to-tenant failed for ${tenantName} (${response.status}): ${body}`);
  }

  /**
   * Make `tenantId` the CALLER's active Cognee tenant (authenticated as the tenant's own
   * login, not the owner — `select_tenant` only ever operates on the authenticated caller).
   * This is what actually makes `user.tenant_id` match the silo tenant's datasets — plain
   * membership (`_addUserToTenant`) alone is not enough, per Cognee's own
   * `get_all_user_permission_datasets` dataset filter.
   */
  private async _selectTenant(userToken: string, tenantId: string, tenantName: string): Promise<void>
  {
    const response = await fetch(`${this.config.cogneeEndpoint}/api/v1/permissions/tenants/select`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ tenant_id: tenantId }),
    });

    if (!response.ok)
    {
      const body = await response.text();
      throw new Error(`Cognee select-tenant failed for ${tenantName} (${response.status}): ${body}`);
    }
  }

  /** Read this tenant's Cognee login + silo-tenant-membership state, or `undefined` if absent. */
  private async _readCredentialsSecret(namespace: string, tenantName: string): Promise<_CogneeCredentials | undefined>
  {
    try
    {
      const secret = await this.coreApi.readNamespacedSecret({ name: _CredentialsSecretName(tenantName), namespace });
      const data = secret.data ?? {};
      const username = data["username"] ? Buffer.from(data["username"], "base64").toString("utf8") : "";
      const password = data["password"] ? Buffer.from(data["password"], "base64").toString("utf8") : "";
      const tenantId = data["tenantId"] ? Buffer.from(data["tenantId"], "base64").toString("utf8") : "";
      if (!username || !password)
      {
        return undefined;
      }

      return { username, password, tenantId };
    }
    catch
    {
      return undefined;
    }
  }

  /** Write this tenant's Cognee login + silo-tenant-membership state (create-or-replace). */
  private async _writeCredentialsSecret(namespace: string, tenantName: string, credentials: _CogneeCredentials): Promise<void>
  {
    const secret: k8s.V1Secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: _CredentialsSecretName(tenantName),
        namespace,
        labels: _BuildTenantLabels(tenantName),
      },
      type: "Opaque",
      data: {
        username: Buffer.from(credentials.username).toString("base64"),
        password: Buffer.from(credentials.password).toString("base64"),
        tenantId: Buffer.from(credentials.tenantId).toString("base64"),
      },
    };

    await __K8sApplyResource(this.objectApi, secret, this.log);
  }
}

/** Decoded shape persisted in a tenant's `_CredentialsSecretName` Secret. */
interface _CogneeCredentials
{
  username: string;
  password: string;
  /** Empty until `ensureTenantJoinedToSiloTenant` resolves the silo's shared Cognee Tenant. */
  tenantId: string;
}

/**
 * The per-tenant Secret name carrying this tenant's Cognee login (`username`/`password`
 * fields), consumed by `_BuildDeployment` (COGNEE_USERNAME/COGNEE_PASSWORD env vars).
 */
export function _CredentialsSecretName(tenantName: string): string
{
  return `openclaw-${tenantName}-cognee-credentials`;
}
