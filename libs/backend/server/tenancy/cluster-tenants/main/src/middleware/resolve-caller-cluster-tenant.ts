import type { PrismaClient } from "@prisma/client";

import { _log } from "../log.js";

/**
 * Resolve the caller's ClusterTenant from their stable IdP subject and authoritative organisation
 * memberships, fail-closed. At most one membership may match, and its `clusterTenant` is returned;
 * null on a missing/ambiguous subject or any lookup failure — never an arbitrary pick and never
 * taken from request input.
 *
 * Single source of truth (Track AIR) for the ClusterTenant scope guard (mutation authz), the
 * read-time scope filters (including the savings-recommendation feed), and `/auth/me`
 * introspection. Keep these on one implementation so the fail-closed rule cannot drift between
 * call sites.
 *
 * `scopeClusterTenant` narrows the lookup to a single silo BEFORE the at-most-one rule is applied.
 * Without it the lookup is global, so a human who legitimately belongs to more than one
 * ClusterTenant is ambiguous (>1 match) and fail-closes to null. Callers that already know which
 * silo is in play pass it so that human resolves correctly:
 *  - `/auth/me` derives it from the request host (the org the caller is currently viewing);
 *  - the mutation guard passes the targeted resource's owning ClusterTenant.
 * The filter is self-validating — an unknown or foreign silo simply yields zero rows (null/deny),
 * never an arbitrary pick.
 *
 * @param prisma             - Prisma client for the subject-to-membership lookup.
 * @param subject            - Stable subject from the established OIDC session.
 * @param scopeClusterTenant - Optional silo to scope the lookup to; omit for a global subject match.
 * @returns The caller's ClusterTenant, or null when unresolved or ambiguous.
 */
export async function _ResolveCallerClusterTenant(
  prisma: PrismaClient,
  subject: string | undefined,
  scopeClusterTenant?: string | undefined,
): Promise<string | null>
{
  const normalized = typeof subject === "string" ? subject.trim() : "";
  if (!normalized)
  {
    return null;
  }

  const scope = typeof scopeClusterTenant === "string" ? scopeClusterTenant.trim() : "";

  try
  {
    const matches = await prisma.orgMembership.findMany({
      where: {
        subject: normalized,
        ...(scope ? { clusterTenant: scope } : {}),
      },
      select: { clusterTenant: true },
      take: 2,
    });
    if (matches.length !== 1)
    {
      return null;
    }
    return matches[0].clusterTenant;
  }
  catch (err)
  {
    // Fail closed (deny) AND surface it: a lookup error here is an anomaly (DB down / schema
    // drift), not a legitimate "no tenant" — distinguish it from the empty-match return above
    // so an operator debugging unexpected denials isn't blind to a database problem.
    _log.warn({ err, scope: scope || undefined }, "caller ClusterTenant resolution failed; failing closed (deny)");
    return null;
  }
}
