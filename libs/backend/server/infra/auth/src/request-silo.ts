/**
 * Work out which ClusterTenant (silo) the caller is on from the request host. Each
 * organisation is served at `<clusterTenant>.<base>`, so the first DNS label is the silo
 * name; the port is dropped and the label is lower-cased.
 *
 * The label is only a GUESS — this function checks nothing. Callers must treat it that
 * way: the email-to-tenant query filters on it and returns no rows for a host whose first
 * label is not a real silo, so a wrong guess ends in "no silo" rather than the wrong one.
 * A host with no subdomain (`localhost`) yields undefined, and the caller then does an
 * unscoped lookup. Custom domains that do not follow `<org>.<base>` are not matched here.
 *
 * {@link _RequestHost} reads the host itself; this function only pulls the silo label out
 * of it.
 *
 * @param host - The request host, typically from `_RequestHost`.
 * @returns The silo (first DNS label), or undefined when none can be derived.
 */
export function _ClusterTenantFromHost(host: string | undefined): string | undefined
{
  if (!host) return undefined;
  const firstLabel = host.split(":")[0].trim().toLowerCase().split(".")[0];
  return firstLabel || undefined;
}
