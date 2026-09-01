import { URL } from "node:url";

import type { Request } from "express";
import type { Logger } from "pino";
import type * as k8s from "@kubernetes/client-node";
import type { PrismaClient } from "@prisma/client";

import { OidcAuthServiceBase, PrismaOwnedOrgSummaryRepository, _ClusterTenantFromHost, _OrgScope, _RequestHost, _ResolvePerOrgClient, _saveSession, type AuthUser, type LoginClient } from "@opencrane/backend/server/infra/auth";
import { _ResolveCallerClusterTenant } from "@opencrane/backend/server/tenancy/cluster-tenants";

import { PrismaAuthenticatedPrincipalCapabilityUnitOfWork } from "../authenticated-principals/prisma-authenticated-principal-capability-unit-of-work";
import { PrismaGroupClaimProjectionUnitOfWork } from "../group-claims/mirror-groups";
import { _AdmitStandaloneFirstUser } from "../standalone-first-user/standalone-first-user-admission";
import { PrismaStandaloneFirstUserAdmissionUnitOfWork } from "../standalone-first-user/prisma-standalone-first-user-admission-unit-of-work";
import { StandaloneFirstUserAdmissionOutcomes, type StandaloneFirstUserAdmissionAuditPort, type StandaloneFirstUserAdmissionConfig } from "../standalone-first-user/standalone-first-user-admission.types";

/**
 * Adds tenant-bound login admission to the shared OIDC flow.
 *
 * The request host selects a provisioned tenant's OIDC client and organisation scope; the
 * platform host uses the masters client. An unknown or partly provisioned tenant host cannot
 * fall back to the masters client. After the base verifies a callback, this service projects the
 * identity provider's groups before saving the silo-bound session. When a standalone first-owner
 * claim is configured, the service then evaluates it through its audit adapter. An ineligible
 * claim or projection failure fails the login, so the base destroys the newly created session.
 *
 * @see _OrgScope — builds the organisation scope used for a tenant login.
 */
export class OidcAuthService extends OidcAuthServiceBase
{
  /** Resolves membership and tenant data during login and `/auth/me`. */
  private prisma: PrismaClient;

  /** Reads ClusterTenant records while resolving a host's login client. */
  private customApi: k8s.CustomObjectsApi | null;

  /**
   * Enables the deployment-selected first-owner claim for a standalone silo.
   * Null leaves the shared OIDC flow unchanged.
   */
  private readonly standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null;
  /** Records the configured standalone first-owner claim. */
  private readonly standaloneFirstUserAudit: StandaloneFirstUserAdmissionAuditPort | null;

  /**
   * @param log - Parent logger; the base derives an `oidc-auth` child.
   * @param prisma - Reads memberships and resolves the caller's cluster tenant.
   * @param customApi - Reads a ClusterTenant for host-bound login; null uses the masters client.
   * @param standaloneFirstUserAdmission - Enables a standalone-silo first-owner claim when set.
   * @param standaloneFirstUserAudit - Records that claim; required when admission is enabled.
   * @throws When a standalone claim is configured without an audit adapter.
   */
  constructor(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null = null, standaloneFirstUserAudit: StandaloneFirstUserAdmissionAuditPort | null = null)
  {
    super(log, new PrismaOwnedOrgSummaryRepository(prisma));
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
   * Selects the OIDC client that may authenticate the request host.
   *
   * A provisioned tenant host uses the client and organisation scope from its ClusterTenant;
   * the configured platform or standalone host uses the masters client. Any other host fails
   * rather than allowing a tenant login to use platform credentials.
   *
   * Called by: {@link OidcAuthServiceBase.buildLoginUrl} before it records the callback flow.
   * @returns The client and scope to use for this authorization request.
   * @throws When a non-platform host has no provisioned tenant client.
   * @see _OrgScope — builds the organisation scope for the selected tenant.
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
   * Adds the caller's cluster tenant and current organisation-administration capability to `/auth/me`.
   *
   * A null tenant means the lookup was unresolved or ambiguous, such as a multi-silo owner on a
   * host where they have no workspace. The capability comes from the central authorization
   * authority after it refreshes membership-managed grants; no identity-provider role flag can
   * grant product access. Product routes still repeat admission inside their write transaction.
   * Called by: {@link OidcAuthServiceBase.getStatus}.
   * @returns The fresh `clusterTenant` value, which can be null.
   */
  protected override async enrichStatusUser(req: Request, authUser: AuthUser): Promise<Record<string, unknown>>
  {
    const clusterTenant = await _ResolveCallerClusterTenant(this.prisma, authUser.sub, _ClusterTenantFromHost(_RequestHost(req)));
    if (clusterTenant === null)
    {
      return { clusterTenant, productCapabilities: { administerOrganization: false } };
    }
    const capabilities = new PrismaAuthenticatedPrincipalCapabilityUnitOfWork(this.prisma, this.log);
    const administerOrganization = await capabilities.canAdministerOrganization({ siloId: clusterTenant, issuer: authUser.issuer, subject: authUser.sub });
    return { clusterTenant, productCapabilities: { administerOrganization } };
  }

  /**
   * Binds a verified callback to its host silo before accepting its session.
   *
   * The callback must match the tenant client recorded when login began. The service projects
   * external groups before it saves the silo-bound session, so authorization is stored before
   * later request middleware can read the session. A configured first-owner claim runs afterwards
   * through the required audit adapter; it promotes an admitted owner, preserves an invitee after
   * `AlreadyClaimed`, and rejects an ineligible claim or infrastructure failure.
   *
   * Called by: {@link OidcAuthServiceBase.completeLogin} after it exchanges and verifies the OIDC
   * callback. This service makes failures fatal, so the base destroys the regenerated session.
   * @throws When the host, callback client, group projection, or first-owner admission is invalid.
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

    const cmd = { siloId: hostClusterTenant, issuer: authUser.issuer, subject: authUser.sub, email: authUser.email, displayName: authUser.name, groups: authUser.groups, log: this.log };
    const task = new PrismaGroupClaimProjectionUnitOfWork(this.prisma);
    await task.reconcile(cmd);
    req.session.authUser = { ...authUser, siloId: hostClusterTenant };
    await _saveSession(req);

    if (this.standaloneFirstUserAdmission === null)
    {
      return;
    }

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

    req.session.authUser = { ...authUser, siloId: hostClusterTenant };
    await _saveSession(req);
  }

  /** Makes callback-projection and configured first-owner failures reject the login. */
  protected override isPostLoginFailureFatal(): boolean
  {
    return true;
  }
}

/**
 * Creates the identity application's host-bound OIDC service.
 *
 * Supplying a standalone first-owner claim without its audit adapter throws before the app accepts
 * callbacks.
 * @param log - Parent logger for the service.
 * @param prisma - Membership and tenant lookup client.
 * @param customApi - ClusterTenant reader, or null when no per-tenant reader is available.
 * @param standaloneFirstUserAdmission - Optional standalone first-owner admission configuration.
 * @param standaloneFirstUserAudit - Audit adapter required by standalone admission.
 * @returns The service the auth router uses for login and status requests.
 * @throws When standalone admission is configured without an audit adapter.
 */
export function ___CreateOidcAuthService(log: Logger, prisma: PrismaClient, customApi: k8s.CustomObjectsApi | null = null, standaloneFirstUserAdmission: StandaloneFirstUserAdmissionConfig | null = null, standaloneFirstUserAudit: StandaloneFirstUserAdmissionAuditPort | null = null): OidcAuthService
{
  return new OidcAuthService(log, prisma, customApi, standaloneFirstUserAdmission, standaloneFirstUserAudit);
}
