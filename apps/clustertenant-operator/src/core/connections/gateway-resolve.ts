import type { PrismaClient } from "@prisma/client";

import { _NamespaceForOrg } from "../../shared/org-namespace.js";

/**
 * The authoritative routing decision the identity-routing gateway proxy needs to
 * forward one user's gateway WebSocket to their own OpenClaw pod:
 *  - `user`        — the IdP-verified identity the proxy logs / rate-limits on.
 *  - `tenant`      — the resolved per-user OpenClaw tenant (one pod per user).
 *  - `podService`  — the in-cluster Service the proxy reverse-proxies to. The proxy
 *                    composes the FQDN + port itself (`<name>.<namespace>.svc:<port>`),
 *                    so transport details never leak into the control plane.
 */
export interface GatewayResolveResult
{
  user: { email: string; sub: string };
  tenant: { name: string; clusterTenantRef: string | null };
  podService: { name: string; namespace: string };
}

/** Fail-closed reasons a gateway target cannot be resolved (all map to 403 at the edge). */
export type GatewayResolveFailure = "NO_EMAIL" | "NO_TENANT" | "AMBIGUOUS_TENANT" | "MEMBER_SUSPENDED";

/**
 * Whether the given subject holds a SUSPENDED OrgMembership in the org (`#126` license lifecycle).
 * The silo read-model is the projection of the fleet's authoritative membership; a Suspended row
 * means billing disabled the member's license, so the connect path must fail closed. A missing
 * membership row ⇒ NOT suspended (legacy/standalone tenants with no org ref, or a member the
 * projection has not populated, keep working — suspension is an explicit Suspended row, never an
 * absence).
 *
 * @param prisma           - Prisma client for the silo OrgMembership read-model.
 * @param clusterTenantRef - The tenant's owning org (null ⇒ no membership scope ⇒ not suspended).
 * @param subject          - The session subject to check.
 * @returns True only when an OrgMembership row exists for (org, subject) AND its status is Suspended.
 */
export async function _IsMemberSuspended(prisma: PrismaClient, clusterTenantRef: string | null, subject: string): Promise<boolean>
{
  if (!clusterTenantRef || !subject)
  {
    return false;
  }
  const membership = await prisma.orgMembership.findUnique({
    where: { clusterTenant_subject: { clusterTenant: clusterTenantRef, subject } },
    select: { status: true },
  });
  return membership?.status === "Suspended";
}

/** Resolution outcome: a forward target, or a fail-closed reason. */
export type GatewayResolveOutcome =
  | { ok: true; resolved: GatewayResolveResult }
  | { ok: false; code: GatewayResolveFailure };

/**
 * Resolve the OpenClaw pod a session may reach, **solely** from the IdP-verified
 * email — there is no request-supplied tenant input, and the resolution is the same
 * fail-closed email→tenant rule used by `/pod-token` (see
 * {@link _ResolveCallerClusterTenant}): zero matches or an ambiguous (>1) match
 * resolves to a forbidden outcome, never an arbitrary pick. This is the routing-level
 * half of cross-tenant safety; the pod-level half is per-pod owner pinning (CONN.10).
 *
 * `scopeClusterTenant` narrows the lookup to the silo the connection is coming in on
 * (derived from the request host by the caller). A human who owns a workspace in more
 * than one silo would otherwise be ambiguous (>1) and fail closed everywhere; scoping
 * routes them to the pod for the host they are connecting through. Self-validating: a
 * foreign/unknown silo yields zero rows → NO_TENANT, never a foreign pod.
 *
 * The pod's namespace is re-derived from the tenant's owning org
 * (`opencrane-<clusterTenantRef>`); a tenant with no org ref (legacy single-namespace
 * install) falls back to the control plane's own namespace.
 *
 * @param prisma             - Prisma client for the email→tenant lookup.
 * @param defaultNamespace   - Namespace for tenants with no org ref (the CP's own ns).
 * @param email              - The session's verified email claim.
 * @param sub                - The session subject (logged identity); falls back to email.
 * @param scopeClusterTenant - Optional silo to scope the lookup to; omit for a global match.
 * @returns A forward target, or a fail-closed reason.
 */
export async function _ResolveGatewayTarget(
  prisma: PrismaClient,
  defaultNamespace: string,
  email: string | undefined,
  sub: string,
  scopeClusterTenant?: string | undefined,
): Promise<GatewayResolveOutcome>
{
  const normalized = typeof email === "string" ? email.toLowerCase().trim() : "";
  if (!normalized)
  {
    return { ok: false, code: "NO_EMAIL" };
  }

  // Fail closed: at most one tenant may match. `take: 2` is enough to detect ambiguity
  // without scanning the whole table — an ambiguous email must never silently route the
  // caller to one of several pods (which could be another user's).
  const scope = typeof scopeClusterTenant === "string" ? scopeClusterTenant.trim() : "";
  const matches = await prisma.tenant.findMany({
    where: { email: { equals: normalized, mode: "insensitive" }, ...(scope ? { clusterTenantRef: scope } : {}) },
    select: { name: true, clusterTenantRef: true },
    take: 2,
  });

  if (matches.length === 0)
  {
    return { ok: false, code: "NO_TENANT" };
  }
  if (matches.length > 1)
  {
    return { ok: false, code: "AMBIGUOUS_TENANT" };
  }

  const tenant = matches[0];

  // Fail closed on a suspended membership (#126): billing disabled this member's license, so the
  // gateway upgrade must be refused even though a pod exists. Keyed on the tenant's owning org +
  // the session subject; a tenant with no org ref (legacy/standalone) has no membership row and is
  // allowed through.
  if (await _IsMemberSuspended(prisma, tenant.clusterTenantRef, sub))
  {
    return { ok: false, code: "MEMBER_SUSPENDED" };
  }

  const namespace = tenant.clusterTenantRef ? _NamespaceForOrg(tenant.clusterTenantRef) : defaultNamespace;

  return {
    ok: true,
    resolved: {
      user: { email: normalized, sub: sub.length > 0 ? sub : normalized },
      tenant: { name: tenant.name, clusterTenantRef: tenant.clusterTenantRef },
      podService: { name: `openclaw-${tenant.name}`, namespace },
    },
  };
}
