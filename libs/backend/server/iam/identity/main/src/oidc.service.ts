import type { Request } from "express";
import type { Logger } from "pino";
import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { OidcAuthServiceBase, PrismaOrgMembershipRepository, _ClusterTenantFromHost, _OrgScope, _RequestHost, _ResolvePerOrgClient, _saveSession, type AuthUser, type LoginClient } from "@opencrane/backend/_server/auth";

import { _MirrorGroupsOnLogin } from "./mirror-groups.js";
import { _AdmitStandaloneFirstUser } from "./standalone-first-user-admission.js";
import { PrismaStandaloneFirstUserAdmissionUnitOfWork } from "./prisma-standalone-first-user-admission-unit-of-work.js";
import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionConfig } from "./standalone-first-user-admission.types.js";
import { _ResolveCallerClusterTenant } from "@opencrane/backend/server/tenancy/cluster-tenants";

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
   * Deployment-owned one-time owner bootstrap. Null leaves the shared OIDC flow unchanged;
   * a configured standalone silo performs the narrow verified-email admission on every login.
   */
  private readonly standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null;

  /**
   * @param log            - Parent logger; a child scoped to `oidc-auth` is derived by the base.
   * @param prisma         - Prisma client for the organization-membership repository and `/auth/me`
   *                         email→tenant lookup.
   * @param customApi      - Kubernetes custom-objects client used to read the cluster-scoped
   *                         ClusterTenant CR for per-org login resolution; null in dev/test (login
   *                         then always uses the masters client).
   * @param standaloneFirstUserAdmission - Optional standalone-silo first-owner admission contract.
   */
  constructor(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null = null)
  {
    super(log, new PrismaOrgMembershipRepository(prisma));
    this.prisma = prisma;
    this.customApi = customApi;
    this.standaloneFirstUserAdmission = standaloneFirstUserAdmission;
  }

  /**
   * Resolve the per-org OIDC client for this request host from the ClusterTenant CR; fall
   * through to the masters client when the host maps to no fully-provisioned org.
   */
  protected override async resolveLoginClient(req: Request): Promise<LoginClient>
  {
    const perOrg = await _ResolvePerOrgClient(this.customApi, _RequestHost(req), this.log);
    if (!perOrg)
    {
      return super.resolveLoginClient(req);
    }
    const config = await this.discoverForClient(perOrg.clientId);
    return { config, scope: `${this.config.scopes} ${_OrgScope(perOrg.orgId)}`, clientId: perOrg.clientId };
  }

  /**
   * Add the caller's `clusterTenant` to `/auth/me`, resolved fresh from their verified subject
   * scoped to the silo derived from the request host. Null when unresolved/ambiguous (a
   * multi-silo owner viewing a host they own no workspace on, or "No tenant yet").
   */
  protected override async enrichStatusUser(req: Request, authUser: AuthUser): Promise<Record<string, unknown>>
  {
    const clusterTenant = await _ResolveCallerClusterTenant(this.prisma, authUser.sub, _ClusterTenantFromHost(_RequestHost(req)));
    return { clusterTenant };
  }

  /**
   * Mirror optional OIDC group projection, then claim the configured standalone owner slot from
   * verified callback facts. The durable claim is subject-bound and failure is browser-visible.
   */
  protected override async onLoginEstablished(req: Request, authUser: AuthUser): Promise<void>
  {
    // 1. Keep optional group projection independent so its outage cannot hide first-owner admission.
    try
    {
      await _MirrorGroupsOnLogin({ prisma: this.prisma, subject: authUser.sub, groups: authUser.groups, log: this.log });
    }
    catch (err)
    {
      this.log.warn({ err, subject: authUser.sub }, "OIDC group projection failed (non-fatal)");
    }

    // 2. Leave non-standalone installs on their existing membership-projection path.
    if (this.standaloneFirstUserAdmission === null)
    {
      return;
    }

    // 3. Atomically claim only the configured silo owner from verified OIDC and host evidence.
    const admission = await _AdmitStandaloneFirstUser(this.standaloneFirstUserAdmission, new PrismaStandaloneFirstUserAdmissionUnitOfWork(this.prisma), {
      hostClusterTenant: _ClusterTenantFromHost(_RequestHost(req)),
      issuer: authUser.issuer,
      subject: authUser.sub,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
    });
    if (admission.outcome !== StandaloneFirstUserAdmissionOutcomes.Admitted && admission.outcome !== StandaloneFirstUserAdmissionOutcomes.AlreadyOwner)
    {
      throw new Error(`standalone first-user admission denied: ${admission.outcome}`);
    }

    // 4. Persist the cache used by existing management gates; /auth/me independently re-derives it.
    req.session.authUser = { ...authUser, isOrgAdmin: true };
    await _saveSession(req);
  }

  /** Surface a configured standalone first-owner failure instead of redirecting into no-tenant. */
  protected override isPostLoginFailureFatal(): boolean
  {
    return this.standaloneFirstUserAdmission !== null;
  }
}

/**
 * Create the OIDC auth service used by the clustertenant-manager Express app.
 * @param log            - Parent logger.
 * @param prisma         - Prisma client for the `/auth/me` email→tenant lookup + membership facts.
 * @param customApi      - Kubernetes custom-objects client for per-org login CR reads (null in dev/test).
 * @param standaloneFirstUserAdmission - Optional one-time owner admission for a standalone silo.
 */
export function ___CreateOidcAuthService(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null = null): OidcAuthService
{
  return new OidcAuthService(log, prisma, customApi, standaloneFirstUserAdmission);
}
