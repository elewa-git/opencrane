import { URL } from "node:url";

import type { Request } from "express";
import type { Logger } from "pino";
import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { OidcAuthServiceBase, PrismaOrgMembershipRepository, _ClusterTenantFromHost, _OrgScope, _RequestHost, _ResolvePerOrgClient, _saveSession, type AuthUser, type LoginClient } from "@opencrane/backend/server/infra/auth";

import { _MirrorGroupsOnLogin, PrismaGroupClaimProjectionUnitOfWork } from "./mirror-groups";
import { _AdmitStandaloneFirstUser } from "./standalone-first-user-admission";
import { PrismaStandaloneFirstUserAdmissionUnitOfWork } from "./prisma-standalone-first-user-admission-unit-of-work";
import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionConfig } from "./standalone-first-user-admission.types";
import { _ResolveCallerClusterTenant } from "@opencrane/backend/server/tenancy/cluster-tenants";

/**
 * The clustertenant-manager's OIDC auth service. Extends the shared
 * {@link OidcAuthServiceBase} (provider discovery, PKCE login, token exchange, claim
 * validation, session lifecycle, membership-derived org-admin facts) with the two
 * parts that differ per silo:
 *
 *   - {@link resolveLoginClient} — per-org login. A host `<org>.<base>` (or a customer
 *     vanity domain) that maps to a fully-provisioned ClusterTenant authorizes against THAT
 *     org's Zitadel client + org-restriction scope, so only its user pool may log in. The
 *     platform host uses the masters client. Unknown and unprovisioned tenant hosts fail closed.
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
  /** App-composed audit boundary retained only for the configured standalone owner claim. */
  private readonly standaloneFirstUserAudit: StandaloneFirstUserAdmissionAuditPort | null;

  /**
   * @param log            - Parent logger; a child scoped to `oidc-auth` is derived by the base.
   * @param prisma         - Prisma client for the organization-membership repository and `/auth/me`
   *                         email→tenant lookup.
   * @param customApi      - Kubernetes custom-objects client used to read the cluster-scoped
   *                         ClusterTenant CR for per-org login resolution; null in dev/test (login
   *                         then always uses the masters client).
   * @param standaloneFirstUserAdmission - Optional standalone-silo first-owner admission contract.
   * @param standaloneFirstUserAudit - App-composed audit adapter for standalone owner claims.
   */
  constructor(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null = null, standaloneFirstUserAudit: StandaloneFirstUserAdmissionAuditPort | null = null)
  {
    super(log, new PrismaOrgMembershipRepository(prisma));
    if (standaloneFirstUserAdmission !== null && standaloneFirstUserAudit === null)
    {
      throw new Error("standalone first-user admission requires an audit adapter");
    }
    this.prisma = prisma;
    this.customApi = customApi;
    this.standaloneFirstUserAdmission = standaloneFirstUserAdmission;
    this.standaloneFirstUserAudit = standaloneFirstUserAudit;
  }

  /**
   * Resolve the per-org OIDC client for this request host from the ClusterTenant CR; fall
   * use the masters client only on the configured platform host.
   */
  protected override async resolveLoginClient(req: Request): Promise<LoginClient>
  {
    const perOrg = await _ResolvePerOrgClient(this.customApi, _RequestHost(req), this.log);
    if (!perOrg)
    {
      const requestHost = _RequestHost(req)?.split(":")[0]?.trim().toLowerCase() ?? "";
      const platformHost = new URL(this.config.redirectUri).host.split(":")[0].trim().toLowerCase();
      const standaloneHost = this.standaloneFirstUserAdmission?.clusterTenant.trim().toLowerCase() ?? "";
      if (requestHost !== platformHost && requestHost !== standaloneHost)
      {
        throw new Error("OIDC login requires a provisioned tenant client for this host");
      }
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
   * Bind the callback to its exact silo and project its verified identity and external groups before
   * the session becomes usable. A projection failure rejects the login so request middleware never
   * has to recreate authorization state from cached claims.
   */
  protected override async onLoginEstablished(req: Request, authUser: AuthUser, loginClientId?: string): Promise<void>
  {
    const hostClusterTenant = _ClusterTenantFromHost(_RequestHost(req))?.trim() ?? "";
    if (!hostClusterTenant)
    {
      throw new Error("OIDC callback host does not identify a silo");
    }

    if (this.standaloneFirstUserAdmission !== null)
    {
      if (hostClusterTenant !== this.standaloneFirstUserAdmission.clusterTenant.trim().toLowerCase())
      {
        throw new Error("OIDC callback host does not match the configured standalone silo");
      }
    }
    else
    {
      const platformHost = new URL(this.config.redirectUri).host.split(":")[0].trim().toLowerCase();
      const requestHost = _RequestHost(req)?.split(":")[0]?.trim().toLowerCase() ?? "";
      if (requestHost !== platformHost || loginClientId !== undefined)
      {
        const perOrg = await _ResolvePerOrgClient(this.customApi, _RequestHost(req), this.log);
        if (perOrg === null || perOrg.clusterTenant.trim().toLowerCase() !== hostClusterTenant || perOrg.clientId !== loginClientId)
        {
          throw new Error("OIDC callback is not bound to the tenant client that started login");
        }
      }
    }

    await _MirrorGroupsOnLogin({ siloId: hostClusterTenant, issuer: authUser.issuer, subject: authUser.sub, email: authUser.email, displayName: authUser.name, groups: authUser.groups, log: this.log }, new PrismaGroupClaimProjectionUnitOfWork(this.prisma));
    req.session.authUser = { ...authUser, siloId: hostClusterTenant };
    await _saveSession(req);

    if (this.standaloneFirstUserAdmission === null) return;

    const audit = this.standaloneFirstUserAudit;
    if (audit === null)
    {
      throw new Error("standalone first-user admission audit adapter is unavailable");
    }
    const admission = await _AdmitStandaloneFirstUser(this.standaloneFirstUserAdmission, new PrismaStandaloneFirstUserAdmissionUnitOfWork(this.prisma, audit), {
      hostClusterTenant,
      issuer: authUser.issuer,
      subject: authUser.sub,
      email: authUser.email,
      emailVerified: authUser.emailVerified,
    });
    if (admission.outcome === StandaloneFirstUserAdmissionOutcomes.AlreadyClaimed)
    {
      return;
    }
    if (admission.outcome !== StandaloneFirstUserAdmissionOutcomes.Admitted && admission.outcome !== StandaloneFirstUserAdmissionOutcomes.AlreadyOwner)
    {
      throw new Error(`standalone first-user admission denied: ${admission.outcome}`);
    }

    req.session.authUser = { ...authUser, siloId: hostClusterTenant, isOrgAdmin: true };
    await _saveSession(req);
  }

  /** Reject every login whose exact-silo projection or standalone admission fails. */
  protected override isPostLoginFailureFatal(): boolean
  {
    return true;
  }
}

/**
 * Create the OIDC auth service used by the clustertenant-manager Express app.
 * @param log            - Parent logger.
 * @param prisma         - Prisma client for the `/auth/me` email→tenant lookup + membership facts.
 * @param customApi      - Kubernetes custom-objects client for per-org login CR reads (null in dev/test).
 * @param standaloneFirstUserAdmission - Optional one-time owner admission for a standalone silo.
 * @param standaloneFirstUserAudit - App-composed audit adapter for that owner admission.
 */
export function ___CreateOidcAuthService(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null = null, standaloneFirstUserAudit: StandaloneFirstUserAdmissionAuditPort | null = null): OidcAuthService
{
  return new OidcAuthService(log, prisma, customApi, standaloneFirstUserAdmission, standaloneFirstUserAudit);
}
