import * as k8s from "@kubernetes/client-node";
import type { Logger } from "pino";

import { CLUSTER_TENANT_CRD_PLURAL, OPENCRANE_API_GROUP, OPENCRANE_API_VERSION, _IsK8sNotFound } from "@opencrane/backend/server/infra/api";

import { _ClusterTenantFromHost } from "./request-silo";
import type { ResolvedPerOrgClient } from "./per-org-client.types";

/**
 * Build the Zitadel org-restriction login scope for an org id. Adding
 * `urn:zitadel:iam:org:id:{orgId}` to the authorization request restricts the login to
 * that organisation's user pool, so only members of the org may authenticate at its host.
 * Centralised so the provisioner-side string and the login-side string can never drift.
 *
 * @param orgId - The Zitadel Organization id of the per-org client.
 * @returns The org-scope string to append to the OIDC `scope` parameter.
 * @see https://zitadel.com/docs/apis/openidoauth/scopes
 */
export function _OrgScope(orgId: string): string
{
  return `urn:zitadel:iam:org:id:${orgId}`;
}

/** The per-org spec fields the login resolver reads off the cluster-scoped ClusterTenant CR. */
interface ClusterTenantCrForLogin
{
  metadata?: { name?: string };
  spec?: {
    vanityDomain?: string;
    zitadel?: { clientId?: string; orgId?: string; redirectUri?: string };
    owner?: { subject?: string; email?: string };
  };
}

/**
 * Find the per-organisation OIDC client for the host a request arrived on, by reading the
 * cluster-scoped **ClusterTenant custom resource**. The fleet manager writes the public
 * Zitadel ids onto that resource, and it is the only place this code looks — a silo keeps
 * no database copy of them.
 *
 * A host maps to a ClusterTenant in one of two ways:
 *   - `<org>.<base>` — the first DNS label is the resource name, fetched with one `get`.
 *     This is the common case and is tried first.
 *   - A customer's own domain — the whole host (port stripped, lower-cased) equals some
 *     resource's `spec.vanityDomain`, found by listing all of them.
 *
 * On a match the organisation's `{clientId, orgId, redirectUri}` is returned so login
 * authorizes against that organisation's own user pool and nobody else's.
 *
 * Returns null — meaning "use the masters client" — in every one of these cases:
 *   - no Kubernetes client was wired (development and tests),
 *   - the request carried no host,
 *   - the host matched no resource, by either name or vanity domain,
 *   - the matched organisation is only half provisioned, that is missing
 *     `spec.zitadel.clientId` or `spec.zitadel.orgId`,
 *   - the `get` or the `list` failed.
 * There is deliberately no partial per-organisation login: it is either a fully
 * provisioned organisation client or the masters client. Because the custom resource
 * decides, a made-up host cannot pick up a client belonging to someone else.
 *
 * Logging levels are chosen on purpose: an unmatched host is logged at debug (usually
 * scanner traffic on the wildcard), while a matched-but-unprovisioned organisation is
 * logged at warn, because that one is an operational fault a human must fix.
 *
 * Called by: `OidcAuthService.resolveLoginClient` in
 * libs/backend/server/iam/identity/main/src/auth/oidc.service.ts.
 *
 * @param customApi - Kubernetes custom-objects client, or null when no cluster is wired.
 * @param host      - The request host, normally from {@link _RequestHost}.
 * @param log       - Logger supplied by the consuming application.
 * @returns The organisation's client details, or null to fall back to the masters client.
 * @see https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/
 *      — the custom-resource `get`/`list` calls used below.
 * @see https://zitadel.com/docs/apis/openidoauth/scopes — what `orgId` is for; see
 *      {@link _OrgScope}.
 */
export async function _ResolvePerOrgClient(customApi: k8s.CustomObjectsApi | null, host: string | undefined, log: Logger): Promise<ResolvedPerOrgClient | null>
{
  if (!customApi)
  {
    // No cluster wired (dev/test): per-org resolution is unavailable, so login uses the
    // masters client. Benign and expected, so debug.
    log.debug("per-org client resolution: no cluster client wired; falling through to masters client");
    return null;
  }
  if (!host)
  {
    // No host on the request (e.g. a non-proxied internal call) — there is nothing to
    // resolve a silo from, so login uses the masters client. Benign and expected, so debug.
    log.debug("per-org client resolution: request carries no host; falling through to masters client");
    return null;
  }

  // 1. Resolve the ClusterTenant CR for this host. Try the canonical first DNS label first
  //    (the common case, one `get`), then fall back to listing and matching an exact
  //    vanity-domain on the full host (port-stripped, lower-cased). The CR is authoritative,
  //    so a fabricated host that matches neither a real CR name nor a real vanity domain
  //    cannot select an org client it does not own.
  const candidate = _ClusterTenantFromHost(host);
  const normHost = host.split(":")[0].trim().toLowerCase();
  let cr = candidate ? await _GetClusterTenantCr(customApi, candidate, log) : null;
  if (!cr)
  {
    cr = await _FindClusterTenantCrByVanity(customApi, normHost, log);
  }
  if (!cr)
  {
    // A host that matches no CR name and no vanity domain is usually probe/scanner noise
    // hitting the wildcard, not an operational fault — log at debug so it is traceable
    // without flooding the error log.
    log.debug({ host, candidate }, "per-org client resolution: host matches no ClusterTenant CR (label or vanity); falling through to masters client");
    return null;
  }

  // 2. Fail-closed on a half-provisioned org: both the client_id (the credential) and the
  //    org id (the user-pool restriction scope) must exist, else we cannot build a SAFE
  //    org-scoped login and fall through to the masters client rather than logging in
  //    against the wrong / an unrestricted pool.
  const name = cr.metadata?.name ?? candidate ?? "";
  const zitadel = cr.spec?.zitadel;
  if (!zitadel?.clientId || !zitadel?.orgId)
  {
    // A real operational anomaly: a ClusterTenant CR exists for this host but its Zitadel org
    // is not fully provisioned, so login at its own subdomain silently degrades to the masters
    // client. Warn so the failed/pending provisioning surfaces instead of a confusing
    // wrong-pool login.
    log.warn(
      { host, clusterTenant: name, hasClientId: Boolean(zitadel?.clientId), hasOrgId: Boolean(zitadel?.orgId) },
      "per-org client resolution: ClusterTenant host is not fully provisioned in Zitadel; login falls through to masters client",
    );
    return null;
  }

  return {
    clusterTenant: name,
    clientId: zitadel.clientId,
    orgId: zitadel.orgId,
    redirectUri: zitadel.redirectUri ?? null,
    ownerSubject: cr.spec?.owner?.subject?.trim() || null,
    ownerEmail: cr.spec?.owner?.email?.trim().toLowerCase() || null,
  };
}

/**
 * Read one cluster-scoped ClusterTenant CR by name. Returns null when the CR is absent
 * (404) or any read error — the caller then tries the vanity lookup / masters client.
 */
async function _GetClusterTenantCr(customApi: k8s.CustomObjectsApi, name: string, log: Logger): Promise<ClusterTenantCrForLogin | null>
{
  try
  {
    return await customApi.getClusterCustomObject({
      group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, plural: CLUSTER_TENANT_CRD_PLURAL, name,
    }) as ClusterTenantCrForLogin;
  }
  catch (err)
  {
    if (_IsK8sNotFound(err)) return null;
    // A transient cluster error must not hard-fail login — fall through to the masters client.
    log.warn({ err, name }, "per-org client resolution: ClusterTenant CR read failed; falling through to masters client");
    return null;
  }
}

/**
 * Find the cluster-scoped ClusterTenant CR whose `spec.vanityDomain` matches `normHost`.
 * Returns null when none matches or on any list error (→ masters client).
 */
async function _FindClusterTenantCrByVanity(customApi: k8s.CustomObjectsApi, normHost: string, log: Logger): Promise<ClusterTenantCrForLogin | null>
{
  try
  {
    const list = await customApi.listClusterCustomObject({
      group: OPENCRANE_API_GROUP, version: OPENCRANE_API_VERSION, plural: CLUSTER_TENANT_CRD_PLURAL,
    }) as { items?: ClusterTenantCrForLogin[] };
    const items = Array.isArray(list.items) ? list.items : [];
    return items.find(item => item.spec?.vanityDomain?.trim().toLowerCase() === normHost) ?? null;
  }
  catch (err)
  {
    log.warn({ err, normHost }, "per-org client resolution: ClusterTenant CR list (vanity match) failed; falling through to masters client");
    return null;
  }
}
