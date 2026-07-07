import crypto from "node:crypto";

import { _log } from "../../log.js";
import type { ZitadelCandidateKeyValidation, ZitadelProvisionOrgInput, ZitadelProvisionOrgResult, ZitadelSetRedirectUrisInput, ZitadelClientConfig, ZitadelManagementClient } from "./zitadel-client.types.js";

export type { ZitadelClientConfig };

/** Shape of the Zitadel service-account key JSON (`type: serviceaccount`). */
interface _ServiceAccountKey
{
  keyId: string;
  key: string;
  userId: string;
}

/**
 * Parse + validate a Zitadel SA key JSON into the fields the jwt-bearer signer needs.
 * Throws on a malformed key (missing keyId/key/userId) — the single guard shared by the
 * constructor and `reloadKey` so the malformed-key rule cannot drift between them.
 *
 * @param serviceAccountKeyJson - The raw SA key JSON string.
 */
function _ParseServiceAccountKey(serviceAccountKeyJson: string): _ServiceAccountKey
{
  const parsed = JSON.parse(serviceAccountKeyJson) as Partial<_ServiceAccountKey>;
  if (!parsed.keyId || !parsed.key || !parsed.userId)
  {
    throw new Error("Zitadel service-account key is invalid (missing keyId/key/userId)");
  }
  return { keyId: parsed.keyId, key: parsed.key, userId: parsed.userId };
}

/** URL-safe base64 of a string or buffer (JWT segments / signatures). */
function _b64urlSegment(input: string | Buffer): string
{
  return Buffer.from(input).toString("base64url");
}

/**
 * Build + RS256-sign a service-account jwt-bearer assertion for the given key + audience.
 * Pure (no `this`) so it serves both the live client and the throwaway candidate signer in
 * `validateCandidateKey` — the candidate path must NEVER touch the live key/token cache.
 *
 * @param saKey  - The parsed SA key to sign with.
 * @param apiUrl - The Zitadel instance base URL (the assertion audience).
 */
function _SignServiceAccountAssertion(saKey: _ServiceAccountKey, apiUrl: string): string
{
  const nowSec = Math.floor(Date.now() / 1000);
  const header = _b64urlSegment(JSON.stringify({ alg: "RS256", kid: saKey.keyId }));
  const claims = _b64urlSegment(JSON.stringify({ iss: saKey.userId, sub: saKey.userId, aud: apiUrl, iat: nowSec, exp: nowSec + 300 }));
  const signingInput = `${header}.${claims}`;
  const signature = _b64urlSegment(crypto.sign("RSA-SHA256", Buffer.from(signingInput), saKey.key));
  return `${signingInput}.${signature}`;
}

/** Scope that requests an access token audience-bound to the Zitadel management API. */
const _MGMT_SCOPE = "openid urn:zitadel:iam:org:project:id:zitadel:aud";

/** Read the live-client config from env, or null when not (fully) configured. */
export function _ReadZitadelClientConfig(): ZitadelClientConfig | null
{
  const apiUrl = process.env.ZITADEL_MGMT_API_URL?.trim() ?? "";
  const serviceAccountKey = process.env.ZITADEL_MGMT_SA_KEY?.trim() ?? "";
  const baseDomain = process.env.PLATFORM_BASE_DOMAIN?.trim() ?? "";

  if (!apiUrl || !serviceAccountKey || !baseDomain)
  {
    return null;
  }
  return { apiUrl, serviceAccountKey, baseDomain };
}

/**
 * Live Zitadel Management API client (S3 / silo Phase 2a). Authenticates as a service
 * account via the JWT-bearer profile (RS256-signed assertion → `/oauth/v2/token`,
 * grant `urn:ietf:params:oauth:grant-type:jwt-bearer`), caches the access token until
 * just before expiry, and drives the per-org provisioning lifecycle validated against
 * the live instance: create Organization → project → bulk roles → OIDC app → grant the
 * master `admin`. Every call is fail-loud; `provisionOrg` compensates by deleting the
 * half-created org if a later step fails, so a partial failure never orphans an org.
 *
 * Requires the SA to hold instance-level `IAM_OWNER` (org create/delete is an
 * instance privilege) — documented as a setup prerequisite.
 */
export class _HttpZitadelManagementClient implements ZitadelManagementClient
{
  /** Trailing-slash-trimmed Zitadel instance base URL. */
  private readonly apiUrl: string;
  /**
   * Parsed service-account key used to sign the jwt-bearer assertion. Mutable: an atomic
   * in-memory swap via {@link reloadKey} replaces it on key rotation (the only writer).
   */
  private saKey: _ServiceAccountKey;
  /** Injectable HTTP transport (global `fetch` in prod; a fake in tests). */
  private readonly fetchImpl: typeof fetch;
  /** Cached management access token + its refresh deadline (epoch ms). */
  private _cachedToken: { value: string; expiresAtMs: number } | null = null;

  /**
   * @param config - The instance URL, SA key JSON, and base domain.
   * @param fetchImpl - Injectable transport (defaults to global `fetch`); tests pass a fake.
   */
  public constructor(config: ZitadelClientConfig, fetchImpl: typeof fetch = fetch)
  {
    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.saKey = _ParseServiceAccountKey(config.serviceAccountKey);
  }

  public async validateCandidateKey(serviceAccountKeyJson: string): Promise<ZitadelCandidateKeyValidation>
  {
    // 1. Parse the candidate into a THROWAWAY signer. A malformed key is an expected
    //    validation failure (not a transport error), so report it as a flagged result —
    //    never mutate the live key/token cache and never throw here.
    let candidate: _ServiceAccountKey;
    try
    {
      candidate = _ParseServiceAccountKey(serviceAccountKeyJson);
    }
    catch (err)
    {
      _log.warn({ err }, "zitadel key rotation: candidate key is malformed (rejected, no change)");
      return { tokenExchangeOk: false, instanceScopeOk: false, keyId: null, detail: "candidate key is malformed (missing keyId/key/userId)" };
    }

    // 2. Exchange the candidate for an access token via the jwt-bearer profile, using a
    //    fresh assertion signed with the CANDIDATE key. A non-OK exchange means the key is
    //    not trusted by the instance — a flagged failure, not an exception.
    let candidateToken: string;
    try
    {
      const assertion = _SignServiceAccountAssertion(candidate, this.apiUrl);
      const res = await this.fetchImpl(`${this.apiUrl}/oauth/v2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion, scope: _MGMT_SCOPE }),
      });
      if (!res.ok)
      {
        _log.warn({ keyId: candidate.keyId, status: res.status }, "zitadel key rotation: candidate token exchange failed (rejected, no change)");
        return { tokenExchangeOk: false, instanceScopeOk: false, keyId: candidate.keyId, detail: `token exchange failed (${res.status})` };
      }
      const json = await res.json() as { access_token?: string };
      if (!json.access_token)
      {
        _log.warn({ keyId: candidate.keyId }, "zitadel key rotation: candidate token exchange returned no access_token (rejected, no change)");
        return { tokenExchangeOk: false, instanceScopeOk: false, keyId: candidate.keyId, detail: "token exchange returned no access_token" };
      }
      candidateToken = json.access_token;
    }
    catch (err)
    {
      // Unexpected transport error (network/DNS) — surface it; the route maps this to a 5xx.
      _log.error({ keyId: candidate.keyId, err }, "zitadel key rotation: transport error during candidate token exchange");
      throw err;
    }

    // 3. Non-destructive instance-`IAM_OWNER` probe: GET /admin/v1/instances/me. The Admin
    //    API is instance-scoped and an org-level manager cannot call it, so a 200 here proves
    //    the candidate holds the instance IAM_OWNER the platform's provisioning path depends
    //    on; a 401/403 proves it authenticated but lacks the scope (flagged, not thrown).
    try
    {
      const probe = await this.fetchImpl(`${this.apiUrl}/admin/v1/instances/me`, {
        method: "GET",
        headers: { authorization: `Bearer ${candidateToken}` },
      });
      if (!probe.ok)
      {
        _log.warn({ keyId: candidate.keyId, status: probe.status }, "zitadel key rotation: candidate lacks instance IAM_OWNER scope (rejected, no change)");
        return { tokenExchangeOk: true, instanceScopeOk: false, keyId: candidate.keyId, detail: `instance IAM_OWNER probe failed (${probe.status})` };
      }
      _log.info({ keyId: candidate.keyId }, "zitadel key rotation: candidate validated (token exchange + instance IAM_OWNER probe OK)");
      return { tokenExchangeOk: true, instanceScopeOk: true, keyId: candidate.keyId, detail: "candidate key validated: token exchange + instance IAM_OWNER probe succeeded" };
    }
    catch (err)
    {
      _log.error({ keyId: candidate.keyId, err }, "zitadel key rotation: transport error during instance IAM_OWNER probe");
      throw err;
    }
  }

  public currentKeyId(): string
  {
    return this.saKey.keyId;
  }

  public reloadKey(serviceAccountKeyJson: string): void
  {
    // Atomic in-memory swap: re-parse (malformed → throw, no partial state) then drop the
    // cached token so the next call re-authenticates with the new key. Single assignment, so
    // an in-flight call either sees the old key+token fully or the new key with a fresh token.
    const next = _ParseServiceAccountKey(serviceAccountKeyJson);
    this.saKey = next;
    this._cachedToken = null;
    _log.info({ keyId: next.keyId }, "zitadel key rotation: live service-account key swapped + token cache cleared");
  }

  public async provisionOrg(input: ZitadelProvisionOrgInput): Promise<ZitadelProvisionOrgResult>
  {
    // 1. Create the dedicated Organization (instance-level). Everything else happens
    //    inside its context via the x-zitadel-orgid header.
    const org = await this._call("POST", "/v2/organizations", { name: input.displayName }) as { organizationId?: string; id?: string };
    const orgId = org.organizationId ?? org.id;
    if (!orgId)
    {
      throw new Error("Zitadel org create returned no organizationId");
    }

    // 2..5. Provision the org's contents; compensate (delete the org) on any failure so
    //       a mid-flight error never leaves an orphaned, half-configured org behind.
    try
    {
      const project = await this._call("POST", "/management/v1/projects", { name: "opencrane" }, orgId) as { id?: string };
      const projectId = project.id;
      if (!projectId)
      {
        throw new Error("Zitadel project create returned no id");
      }

      await this._call("POST", `/management/v1/projects/${projectId}/roles/_bulk`, {
        roles: [
          { key: "owner", displayName: "Owner" },
          { key: "admin", displayName: "Admin" },
          { key: "member", displayName: "Member" },
        ],
      }, orgId);

      // Register the canonical `<org>.<base>` callback plus the customer-vanity callback
      // when the org has a vanity domain, so login works at either host. Zitadel rejects a
      // code exchange whose redirect_uri is not on this list, so both must be present.
      const redirectUris = [input.redirectUri, ...(input.vanityRedirectUri ? [input.vanityRedirectUri] : [])];
      const app = await this._call("POST", `/management/v1/projects/${projectId}/apps/oidc`, {
        name: "login",
        redirectUris,
        responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
        appType: "OIDC_APP_TYPE_WEB",
        authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
        devMode: false,
      }, orgId) as { appId?: string; clientId?: string };
      if (!app.appId)
      {
        throw new Error("Zitadel OIDC app create returned no appId");
      }
      // The live app-create response carries the generated OIDC client_id alongside the
      // appId. Capture it so login can resolve this org's per-org client by host (S3b);
      // without it the org has a login surface but no credential to authorize against it.
      if (!app.clientId)
      {
        throw new Error("Zitadel OIDC app create returned no clientId");
      }

      // Grant the master `admin` on this org's project (cross-org user grant; the master
      // lives in the masters org but is granted into this CT org — the SSO bridge).
      await this._call("POST", `/management/v1/users/${input.masterSubject}/grants`, {
        projectId,
        roleKeys: ["admin"],
      }, orgId);

      // Grant the master ORG_OWNER rights so they can invite team members
      // from within their new Zitadel organization.
      await this._call("POST", "/management/v1/orgs/me/members", {
        userId: input.masterSubject,
        roles: ["ORG_OWNER"],
      }, orgId);

      _log.info({ orgId, projectId, appId: app.appId, orgName: input.orgName, redirectUriCount: redirectUris.length }, "provisioned Zitadel org for ClusterTenant");
      return { orgId, projectId, appId: app.appId, clientId: app.clientId, redirectUri: input.redirectUri };
    }
    catch (err)
    {
      _log.warn({ orgId, orgName: input.orgName, err }, "Zitadel org provisioning failed mid-flight; compensating by deleting the org");
      await this.teardownOrg(orgId).catch(function _ignore() { /* compensation is best-effort */ });
      throw err;
    }
  }

  public async setAppRedirectUris(input: ZitadelSetRedirectUrisInput): Promise<void>
  {
    // Replace the OIDC app's config. Zitadel's update is a FULL PUT of the oidc_config —
    // any settable field omitted here resets to its default. This is safe ONLY because
    // `provisionOrg` is the sole creator of these apps and sets exactly this field set
    // (all other config left at Zitadel defaults), so re-sending the same fields verbatim
    // is a no-op for everything except `redirectUris`. If `provisionOrg`'s app-create body
    // ever gains a non-default field (custom TTLs, PKCE/secret settings, post-logout URIs),
    // it MUST be mirrored here too — keep the two field sets in lock-step. Org-scoped via
    // the x-zitadel-orgid header; fail-loud so a wrapping DB transaction rolls back when the
    // IdP rejects the change.
    await this._call("PUT", `/management/v1/projects/${input.projectId}/apps/${input.appId}/oidc_config`, {
      redirectUris: input.redirectUris,
      responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
      grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE"],
      appType: "OIDC_APP_TYPE_WEB",
      authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
      devMode: false,
    }, input.orgId);
    _log.info({ orgId: input.orgId, projectId: input.projectId, appId: input.appId, redirectUriCount: input.redirectUris.length }, "updated Zitadel OIDC app redirect URIs");
  }

  public async teardownOrg(orgId: string): Promise<void>
  {
    const res = await this.fetchImpl(`${this.apiUrl}/admin/v1/orgs/${orgId}`, {
      method: "DELETE",
      headers: { ...(await this._authHeaders()), "x-zitadel-orgid": orgId },
    });
    // Already-absent org is the desired end state, not an error.
    if (res.ok || res.status === 404)
    {
      return;
    }
    throw new Error(`Zitadel org teardown failed (${res.status}): ${await res.text()}`);
  }

  public async grantProjectRole(orgId: string, projectId: string, subject: string, roleKey: string): Promise<void>
  {
    // Same cross-org user-grant endpoint `provisionOrg` uses for the master `admin`: grant the
    // subject the given project role, scoped to the org via the x-zitadel-orgid header. Fail-loud
    // (via _call) so a caller wrapping this in a DB transaction rolls the membership write back.
    await this._call("POST", `/management/v1/users/${subject}/grants`, {
      projectId,
      roleKeys: [roleKey],
    }, orgId);
    _log.info({ orgId, projectId, subject, roleKey }, "granted Zitadel project role to org member");
  }

  public async listOrgUsers(orgId: string): Promise<Array<{ subject: string; email?: string }>>
  {
    // Zitadel v1 user search: POST /management/v1/users/_search returns `{ result: [...] }`,
    // each entry an org user with an `id` (some builds echo `userId`) and, for human users, a
    // nested `human.email.email`. Org-scoped via the x-zitadel-orgid header (4th `_call` arg).
    // Empty body → no filter, so the whole org pool is returned. Be defensive about the exact
    // field names (v1 search shape is assumed here) and drop any entry without a subject.
    const res = await this._call("POST", "/management/v1/users/_search", {}, orgId) as {
      result?: Array<{ userId?: string; id?: string; human?: { email?: { email?: string } } }>;
    };
    const users: Array<{ subject: string; email?: string }> = [];
    for (const entry of res.result ?? [])
    {
      const subject = entry.userId ?? entry.id;
      if (!subject)
      {
        continue;
      }
      const email = entry.human?.email?.email;
      users.push(email ? { subject, email } : { subject });
    }
    return users;
  }

  public async removeOrgMember(orgId: string, subject: string): Promise<void>
  {
    // Org-scoped delete of the user's org membership: DELETE /management/v1/orgs/me/members/{userId}
    // (the org is resolved from the x-zitadel-orgid header, not the path). Removing the org
    // membership revokes the user's grants in that org. Fail-loud (via _call) so offboarding can
    // keep the local row until the IdP grant is actually gone.
    await this._call("DELETE", `/management/v1/orgs/me/members/${subject}`, undefined, orgId);
    _log.info({ orgId, subject }, "removed org member from Zitadel org");
  }

  /** Issue an authenticated, org-scoped Management API call; throw on any non-OK status. */
  private async _call(method: string, path: string, body: unknown, orgId?: string): Promise<unknown>
  {
    const headers: Record<string, string> = { ...(await this._authHeaders()), "content-type": "application/json" };
    if (orgId)
    {
      headers["x-zitadel-orgid"] = orgId;
    }
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, { method, headers, body: JSON.stringify(body) });
    if (!res.ok)
    {
      throw new Error(`Zitadel ${method} ${path} failed (${res.status}): ${await res.text()}`);
    }
    return res.json().catch(function _empty() { return {}; });
  }

  /** Authorization header carrying a cached-or-fresh management access token. */
  private async _authHeaders(): Promise<Record<string, string>>
  {
    return { authorization: `Bearer ${await this._token()}` };
  }

  /** Acquire (and cache) a management access token via the JWT-bearer SA profile. */
  private async _token(): Promise<string>
  {
    const nowMs = Date.now();
    if (this._cachedToken && nowMs < this._cachedToken.expiresAtMs)
    {
      return this._cachedToken.value;
    }

    const assertion = this._signServiceAccountJwt();
    const res = await this.fetchImpl(`${this.apiUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion, scope: _MGMT_SCOPE }),
    });
    if (!res.ok)
    {
      throw new Error(`Zitadel token exchange failed (${res.status}): ${await res.text()}`);
    }
    const json = await res.json() as { access_token?: string; expires_in?: number };
    if (!json.access_token)
    {
      throw new Error("Zitadel token exchange returned no access_token");
    }
    // Refresh 60s before the stated expiry (default 1h) so a call never races the clock.
    const ttlMs = Math.max(60, (json.expires_in ?? 3600) - 60) * 1000;
    this._cachedToken = { value: json.access_token, expiresAtMs: nowMs + ttlMs };
    return json.access_token;
  }

  /** Build + RS256-sign the service-account assertion JWT (iss/sub = SA userId, aud = instance). */
  private _signServiceAccountJwt(): string
  {
    return _SignServiceAccountAssertion(this.saKey, this.apiUrl);
  }
}

/**
 * Build the Zitadel management client for the process. Returns the live client when
 * configured; **throws** when it is not — the control-plane hard-commits to Zitadel, so
 * the multi-tenant path must never silently run without it. The factory is only called
 * on the multi-tenant path (cluster-tenant manager enabled); a single-cluster install
 * never constructs it, so single-cluster installs are unaffected by the requirement.
 */
export function _BuildZitadelManagementClient(): ZitadelManagementClient
{
  const config = _ReadZitadelClientConfig();
  if (!config)
  {
    throw new Error(
      "Zitadel management is required for the cluster-tenant manager but is not configured. " +
      "Set ZITADEL_MGMT_API_URL, ZITADEL_MGMT_SA_KEY (instance IAM_OWNER service-account key), and PLATFORM_BASE_DOMAIN.",
    );
  }
  return new _HttpZitadelManagementClient(config);
}

/**
 * Derive the OIDC redirect URI for an org's login surface:
 * `https://<org>.<base>/api/v1/auth/callback`. Centralised so the provisioner and the
 * (future) login resolver agree on the exact value registered on the org's Zitadel app.
 */
export function _DeriveOrgRedirectUri(orgName: string, baseDomain: string): string
{
  return `https://${orgName}.${baseDomain}/api/v1/auth/callback`;
}

/**
 * Derive the OIDC redirect URI for an org's customer-vanity host:
 * `https://<vanityDomain>/api/v1/auth/callback`. The vanity domain is a full host (CNAMEd
 * onto the org apex), so it is the authority directly — no base domain is appended. Used
 * to register/sync the vanity callback on the org's Zitadel app.
 */
export function _DeriveVanityRedirectUri(vanityDomain: string): string
{
  return `https://${vanityDomain}/api/v1/auth/callback`;
}
