/**
 * Types for working out, from a request host, which organisation's OIDC client a login
 * should use.
 *
 * Every ClusterTenant gets its own Zitadel Organization and OIDC application when it is
 * created, and the resulting org id, client id, and redirect URI are written onto its
 * ClusterTenant custom resource. A request arriving at that organisation's host must log
 * in against THAT client, so that only members of that organisation can authenticate
 * there.
 *
 * A host is matched either by its first DNS label (`<org>.<base>`, treated as the resource
 * name) or by the full host equalling a resource's `spec.vanityDomain`. See
 * {@link _ResolvePerOrgClient} for the matching order and every fail-closed case.
 */

/**
 * The org-scoped OIDC client resolved for a per-org host. Returned only when the host's
 * ClusterTenant has a fully-provisioned client; an unprovisioned or unknown host yields
 * null (fail-closed → login falls through to the masters client).
 */
export interface ResolvedPerOrgClient
{
  /**
   * The ClusterTenant (silo) name. Taken from the `metadata.name` of the ClusterTenant
   * custom resource that matched the host — NOT confirmed against any database, and not
   * always the host's first DNS label, since a customer vanity domain matches on
   * `spec.vanityDomain` instead.
   */
  clusterTenant: string;

  /** The org's OIDC client_id login authorizes with (the per-org credential). */
  clientId: string;

  /** The org's Zitadel Organization id — added as the `urn:zitadel:iam:org:id:{orgId}` login scope. */
  orgId: string;

  /** The redirect URI registered on the org's app, when known (else null). */
  redirectUri: string | null;

  /** IdP subject configured as the ClusterTenant owner, when present. */
  ownerSubject: string | null;

  /**
   * The owner's email from the resource, lower-cased. A weaker match than
   * {@link ResolvedPerOrgClient.ownerSubject} because a user can change their email at the
   * provider, so use it only while no owner subject has been configured yet.
   */
  ownerEmail: string | null;
}
