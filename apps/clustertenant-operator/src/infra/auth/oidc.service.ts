import type { Request } from "express";
import type { Logger } from "pino";
import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { OidcAuthServiceBase, _RequestHost } from "@opencrane/infra-auth";
import type { AuthUser, LoginClient } from "@opencrane/infra-auth";

import { _AdoptMemberOnLogin } from "./adopt-member.js";
import { _ResolveCallerClusterTenant } from "./resolve-caller-cluster-tenant.js";
import { _ClusterTenantFromHost } from "./request-silo.js";
import { _OrgScope, _ResolvePerOrgClient } from "./per-org-client.js";

/**
 * The clustertenant-manager's OIDC auth service. Extends the shared
 * {@link OidcAuthServiceBase} (provider discovery, PKCE login, token exchange, claim
 * validation, session lifecycle, membership-derived org-admin facts) with the two
 * silo-specific seams:
 *
 *   - {@link resolveLoginClient} — per-org login. A host `<org>.<base>` (or a customer
 *     vanity domain) that maps to a fully-provisioned ClusterTenant authorizes against THAT
 *     org's Zitadel client + org-restriction scope, so only its user pool may log in. The
 *     platform host / any unknown/unprovisioned host falls through to the masters client.
 *   - {@link enrichStatusUser} — `/auth/me` adds the caller's `clusterTenant`, resolved
 *     server-side from their verified email (scoped to the silo whose host they are on),
 *     never from a self-asserted claim.
 */
export class OidcAuthService extends OidcAuthServiceBase
{
  /** Prisma client for the email→tenant→clusterTenant lookup (`/auth/me` enrichment). */
  private prisma: PrismaClient;

  /** Kubernetes custom-objects client for reading the ClusterTenant CR (per-org login). */
  private customApi: k8s.CustomObjectsApi | null;

  /**
   * The namespace the silo's TenantOperator reconciles in (`config.watchNamespace`). Member
   * workspaces seeded on login MUST land here — the same namespace the owner-default seed
   * targets — or the TenantOperator never picks up the CRD (it is NOT the projection-repair
   * `NAMESPACE`, which can differ).
   */
  private watchNamespace: string;

  /**
   * @param log            - Parent logger; a child scoped to `oidc-auth` is derived by the base.
   * @param prisma         - Prisma client (also the base's `OrgMembership` read surface + the
   *                         `/auth/me` email→tenant lookup).
   * @param customApi      - Kubernetes custom-objects client used to read the cluster-scoped
   *                         ClusterTenant CR for per-org login resolution; null in dev/test (login
   *                         then always uses the masters client).
   * @param watchNamespace - The TenantOperator's watch namespace; where first-login member
   *                         workspaces are seeded (parity with the owner-default seed).
   */
  constructor(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, watchNamespace = "default")
  {
    super(log, prisma);
    this.prisma = prisma;
    this.customApi = customApi;
    this.watchNamespace = watchNamespace;
  }

  /**
   * Resolve the per-org OIDC client for this request host from the ClusterTenant CR; fall
   * through to the masters client when the host maps to no fully-provisioned org.
   */
  protected override async resolveLoginClient(req: Request): Promise<LoginClient>
  {
    const perOrg = await _ResolvePerOrgClient(this.customApi, _RequestHost(req));
    if (!perOrg)
    {
      return super.resolveLoginClient(req);
    }
    const config = await this.discoverForClient(perOrg.clientId);
    return { config, scope: `${this.config.scopes} ${_OrgScope(perOrg.orgId)}`, clientId: perOrg.clientId };
  }

  /**
   * Add the caller's `clusterTenant` to `/auth/me`, resolved fresh from their verified email
   * scoped to the silo derived from the request host. Null when unresolved/ambiguous (a
   * multi-silo owner viewing a host they own no workspace on, or "No tenant yet").
   */
  protected override async enrichStatusUser(req: Request, authUser: AuthUser): Promise<Record<string, unknown>>
  {
    const clusterTenant = await _ResolveCallerClusterTenant(this.prisma, authUser.email, _ClusterTenantFromHost(_RequestHost(req)));
    return { clusterTenant };
  }

  /**
   * Adopt the verified user into their org and seed their workspace on first login (#126 S4).
   * Runs only when the login resolved a per-org client (proof of org membership); a masters /
   * platform login is a no-op. Delegated to {@link _AdoptMemberOnLogin}; the base wraps this in
   * a best-effort try/catch so a failure here can never break the login.
   */
  protected override async onLoginEstablished(req: Request, authUser: AuthUser): Promise<void>
  {
    await _AdoptMemberOnLogin({
      prisma: this.prisma,
      customApi: this.customApi,
      namespace: this.watchNamespace,
      host: _RequestHost(req),
      subject: authUser.sub,
      email: authUser.email,
      log: this.log,
    });
  }
}

/**
 * Create the OIDC auth service used by the clustertenant-manager Express app.
 * @param log            - Parent logger.
 * @param prisma         - Prisma client for the `/auth/me` email→tenant lookup + membership facts.
 * @param customApi      - Kubernetes custom-objects client for per-org login CR reads (null in dev/test).
 * @param watchNamespace - The TenantOperator's watch namespace, where first-login member workspaces
 *                         are seeded (defaults to `"default"` for dev/test).
 */
export function ___CreateOidcAuthService(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, watchNamespace = "default"): OidcAuthService
{
  return new OidcAuthService(log, prisma, customApi, watchNamespace);
}
