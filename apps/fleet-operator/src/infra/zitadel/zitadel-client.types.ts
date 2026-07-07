/**
 * Control-plane → Zitadel Management API seam (S3 / silo Phase 2a).
 *
 * The control-plane is the system-of-record that PROVISIONS Zitadel: on ClusterTenant
 * create it makes a dedicated Zitadel Organization + project + roles + OIDC app for the
 * org's isolated user pool, and grants the tenant master `admin`; on delete it tears the
 * org down. This interface is the single seam those lifecycle hooks call, so the call
 * sites stay thin and the orchestration is unit-testable against a fake.
 */

/** Config the live Zitadel management client requires (read from env). */
export interface ZitadelClientConfig
{
  /** Zitadel instance base URL, e.g. https://weownai-oidc-8dwlat.eu1.zitadel.cloud */
  apiUrl: string;
  /** Service-account key JSON (the downloaded Zitadel SA key) used for jwt-bearer auth. */
  serviceAccountKey: string;
  /** Platform base domain used to derive each org's redirect URI (`<org>.<base>`). */
  baseDomain: string;
}

/** Inputs needed to provision a ClusterTenant's Zitadel org + login surface. */
export interface ZitadelProvisionOrgInput
{
  /** ClusterTenant name (the org key) — first DNS label of the org host. */
  orgName: string;
  /** Human-readable org name → the Zitadel Organization display name. */
  displayName: string;
  /** Redirect URI to register on the org's OIDC app (`<org>.<base>/api/v1/auth/callback`). */
  redirectUri: string;
  /**
   * Optional second redirect URI for the org's customer-vanity host
   * (`https://<vanity>/api/v1/auth/callback`), registered alongside the canonical one so
   * login works at the vanity domain too. Omitted when the org has no vanity domain.
   */
  vanityRedirectUri?: string;
  /** IdP subject (Zitadel user id) of the tenant master, granted `admin` on the new org. */
  masterSubject: string;
}

/** Inputs needed to replace the redirect URIs on an existing org's OIDC app. */
export interface ZitadelSetRedirectUrisInput
{
  /** Zitadel Organization id the app lives in (sets the `x-zitadel-orgid` context). */
  orgId: string;
  /** Zitadel project id the app belongs to (the update endpoint is project-scoped). */
  projectId: string;
  /** The OIDC application id whose redirect URIs are being replaced. */
  appId: string;
  /** The full set of redirect URIs the app should have after the update (canonical + any vanity). */
  redirectUris: string[];
}

/**
 * Granular result of validating a CANDIDATE service-account key — the security gate
 * the key-rotation feature requires before swapping the platform's master IdP credential.
 *
 * Both flags must be true for the candidate to be accepted: `tokenExchangeOk` proves the
 * key can authenticate (jwt-bearer exchange succeeds), and `instanceScopeOk` proves the key
 * holds the instance-level `IAM_OWNER` scope the platform depends on (org create/delete) —
 * a key that authenticates but only holds an org-level role would silently break
 * provisioning, so the scope probe is non-negotiable.
 */
export interface ZitadelCandidateKeyValidation
{
  /** Whether the jwt-bearer token exchange succeeded with the candidate key. */
  tokenExchangeOk: boolean;
  /** Whether the candidate key passed the non-destructive instance-`IAM_OWNER` probe. */
  instanceScopeOk: boolean;
  /** The candidate key's `keyId` when the key parsed, else null (malformed/unparseable). */
  keyId: string | null;
  /** Human-readable detail for logging/response (never contains key material). */
  detail: string;
}

/** The Zitadel identifiers persisted onto the ClusterTenant row after provisioning. */
export interface ZitadelProvisionOrgResult
{
  /** Provisioned Zitadel Organization id. */
  orgId: string;
  /** Provisioned project id (the `opencrane` project the OIDC app belongs to). */
  projectId: string;
  /** Provisioned OIDC application id (login surface for `<org>.<base>`). */
  appId: string;
  /** The OIDC client_id of the provisioned app — the per-org credential login authorizes with. */
  clientId: string;
  /** The redirect URI registered on the app (echoed for persistence). */
  redirectUri: string;
}

/**
 * Lifecycle operations the control-plane performs against Zitadel. Implementations are
 * **fail-loud** (throw on any non-OK response) so a caller wrapping them in a DB
 * transaction rolls the local write back on failure; `provisionOrg` additionally
 * compensates (deletes the half-created org) if a mid-flight step fails.
 */
export interface ZitadelManagementClient
{
  /**
   * Provision a dedicated Organization + project + roles + OIDC app for a ClusterTenant
   * and grant the master `admin`. Returns the identifiers to persist. Throws on failure.
   */
  provisionOrg(input: ZitadelProvisionOrgInput): Promise<ZitadelProvisionOrgResult>;

  /**
   * Replace the redirect URIs on an org's existing OIDC app — used when the org's vanity
   * domain is added, changed, or cleared so the app's allowlist tracks the live hosts.
   * Throws on failure so a caller wrapping it in a DB transaction rolls the local write back.
   */
  setAppRedirectUris(input: ZitadelSetRedirectUrisInput): Promise<void>;

  /** Tear down a previously-provisioned org (tolerates an already-absent org). */
  teardownOrg(orgId: string): Promise<void>;

  /**
   * Grant a subject a role on an org's `opencrane` project — the seating step that makes
   * an invited member's `sub` authorizable at the org's login surface. Mirrors the master
   * `admin` grant `provisionOrg` issues (`POST /management/v1/users/{userId}/grants`), scoped
   * to the org via the `x-zitadel-orgid` header. The role keys (`owner`/`admin`/`member`) are
   * the ones `provisionOrg` bulk-creates on the project. Throws on failure so a caller wrapping
   * it in a DB transaction rolls the local membership write back.
   *
   * @param orgId    - Zitadel Organization id the project + user grant live in.
   * @param projectId - Zitadel project id whose role is granted.
   * @param subject  - IdP subject (Zitadel user id) receiving the grant.
   * @param roleKey  - Project role key to grant (`owner` | `admin` | `member`).
   */
  grantProjectRole(orgId: string, projectId: string, subject: string, roleKey: string): Promise<void>;

  /**
   * List the human users in an org's Zitadel user pool — the input the periodic reconcile
   * backstop uses to adopt members who were invited directly in the Zitadel Console (and so
   * never hit the app's member-add route that writes an `OrgMembership`). Org-scoped via the
   * `x-zitadel-orgid` header. Returns `{ subject, email }` per user (`email` optional).
   *
   * @param orgId - Zitadel Organization id whose user pool is listed.
   */
  listOrgUsers(orgId: string): Promise<Array<{ subject: string; email?: string }>>;

  /**
   * Remove a subject from an org's user pool — the IdP half of offboarding. Revokes the
   * user's org membership (and with it their grants in that org) so a removed member can no
   * longer authorize at the org's login surface. Org-scoped via the `x-zitadel-orgid` header;
   * throws on failure so the caller can keep the local `OrgMembership` row until the IdP grant
   * is gone (avoiding a reconcile-driven resurrection of a still-seated member).
   *
   * @param orgId   - Zitadel Organization id the membership lives in.
   * @param subject - IdP subject (Zitadel user id) to remove from the org.
   */
  removeOrgMember(orgId: string, subject: string): Promise<void>;

  /**
   * Validate a CANDIDATE service-account key WITHOUT touching the live client's key or
   * token cache. Builds a throwaway signer from the candidate, performs a jwt-bearer token
   * exchange, then a NON-DESTRUCTIVE instance-`IAM_OWNER` probe (`GET /admin/v1/instances/me`,
   * which an org-level manager cannot call). Returns granular flags; it NEVER throws for an
   * expected validation failure (bad key, wrong scope) — only for unexpected transport errors.
   *
   * The driver of key rotation: the live key is swapped (via {@link reloadKey}) ONLY after
   * this returns `tokenExchangeOk && instanceScopeOk`.
   *
   * @param serviceAccountKeyJson - The candidate SA key JSON to validate.
   */
  validateCandidateKey(serviceAccountKeyJson: string): Promise<ZitadelCandidateKeyValidation>;

  /** The `keyId` of the live service-account key — captured for the rotation audit trail. */
  currentKeyId(): string;

  /**
   * Atomically swap the live client's service-account key to the given candidate and clear
   * the cached access token, so every subsequent call authenticates with the new key. Called
   * ONLY after the candidate has been validated AND persisted to the backing Secret, so a
   * process restart keeps the new key. Throws only on a malformed key (missing keyId/key/userId).
   *
   * @param serviceAccountKeyJson - The validated candidate SA key JSON to make live.
   */
  reloadKey(serviceAccountKeyJson: string): void;
}
