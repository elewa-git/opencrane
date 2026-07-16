/**
 * Types for the SSRF / unsafe-network guard (italanta/opencrane#128, folded #218).
 */

/**
 * DNS resolver surface (injectable for tests): resolve a host to its addresses so
 * the guard can reject a name that resolves to a private/reserved address.
 */
export type HostLookup = (hostname: string) => Promise<Array<{ address: string }>>;
