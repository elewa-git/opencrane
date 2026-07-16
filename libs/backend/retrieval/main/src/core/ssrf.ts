/**
 * SSRF / unsafe-network guard for remote URLs imported from an external MCP
 * registry (italanta/opencrane#128, folded #218). A curated import turns an
 * upstream registry record into a pinned remote catalog entry, so the remote URL
 * is attacker-influenced data — it MUST be validated before OpenCrane (or Obot on
 * OpenCrane's behalf) ever dials it. The check fails closed: only https to a
 * non-private, non-loopback, non-link-local, non-metadata host passes.
 */

/**
 * Thrown when a remote URL is rejected as unsafe to dial. Carries an actionable
 * reason so an import endpoint can surface WHY without leaking probe results.
 */
export class UnsafeRemoteUrlError extends Error
{
  /** Machine-stable code surfaced to API clients for branching. */
  public readonly code = "UNSAFE_REMOTE_URL";

  /**
   * @param reason - Human-readable reason the URL was rejected.
   */
  constructor(reason: string)
  {
    super(`Unsafe remote URL rejected: ${reason}`);
    this.name = "UnsafeRemoteUrlError";
  }
}

/** Hostnames that always denote a local/metadata target regardless of DNS. */
const _BLOCKED_HOSTNAMES = new Set<string>([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

/** Hostname suffixes that denote internal/local networks and never a public host. */
const _BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

/**
 * Validate that a remote URL is safe to dial and return the parsed URL.
 *
 * Fails closed with {@link UnsafeRemoteUrlError} for anything that is not https to
 * a routable public host: malformed URLs, non-https schemes, credentials in the
 * URL, and hosts that are (or are named as) loopback / private / link-local /
 * carrier-grade-NAT / cloud-metadata addresses.
 *
 * @param rawUrl - Candidate remote URL (from an untrusted registry record).
 * @returns The parsed {@link URL} when it passes every check.
 */
export function _AssertSafeRemoteUrl(rawUrl: string): URL
{
  // 1. Parse — a URL we cannot even parse is not one we will dial (fail closed).
  let parsed: URL;
  try
  {
    parsed = new URL(rawUrl);
  }
  catch
  {
    throw new UnsafeRemoteUrlError(`not a valid absolute URL (${rawUrl})`);
  }

  // 2. Scheme — only https; http/ftp/file/gopher are all common SSRF vectors.
  if (parsed.protocol !== "https:")
  {
    throw new UnsafeRemoteUrlError(`scheme must be https, got "${parsed.protocol}"`);
  }

  // 3. Embedded credentials — never dial a URL that smuggles user:pass, which can
  //    be used to confuse the target or exfiltrate a token into the request line.
  if (parsed.username !== "" || parsed.password !== "")
  {
    throw new UnsafeRemoteUrlError("URL must not contain embedded credentials");
  }

  // 4. Host classification — reject literal private/loopback/link-local/metadata
  //    IPs and hostnames that name a local/internal target.
  const host = _normalizeHost(parsed.hostname);
  if (host === "")
  {
    throw new UnsafeRemoteUrlError("URL has no host");
  }

  const reason = _classifyUnsafeHost(host);
  if (reason !== undefined)
  {
    throw new UnsafeRemoteUrlError(reason);
  }

  return parsed;
}

/**
 * Strip an IPv6 bracket wrapper and lowercase a hostname for comparison.
 *
 * @param hostname - `URL.hostname` (IPv6 hosts arrive bracket-stripped already).
 * @returns Normalised host string.
 */
function _normalizeHost(hostname: string): string
{
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return unwrapped.trim().toLowerCase();
}

/**
 * Classify a host as unsafe, returning a reason string, or `undefined` if it
 * passes. Handles IPv4 literals, IPv6 literals (incl. IPv4-mapped), and named
 * hosts on the local/internal blocklist.
 *
 * @param host - Normalised host from {@link _normalizeHost}.
 * @returns Reason the host is unsafe, or `undefined` when it is acceptable.
 */
function _classifyUnsafeHost(host: string): string | undefined
{
  // 1. IPv4 literal — classify against the reserved/private ranges directly.
  const ipv4 = _parseIpv4(host);
  if (ipv4 !== undefined)
  {
    return _isPrivateIpv4(ipv4) ? `host resolves to a private/reserved IPv4 address (${host})` : undefined;
  }

  // 2. IPv6 literal — expand and classify (an IPv4-mapped address is checked as v4).
  if (host.includes(":"))
  {
    return _isPrivateIpv6(host) ? `host is a private/reserved IPv6 address (${host})` : undefined;
  }

  // 3. Named host — reject exact local names and internal suffixes; other names are
  //    left to DNS at dial time (DNS-rebinding hardening is a noted follow-up).
  if (_BLOCKED_HOSTNAMES.has(host))
  {
    return `host is a reserved local/metadata name (${host})`;
  }
  for (const suffix of _BLOCKED_HOST_SUFFIXES)
  {
    if (host.endsWith(suffix))
    {
      return `host uses an internal-only suffix (${host})`;
    }
  }
  return undefined;
}

/**
 * Parse a dotted-quad IPv4 string into 4 octets.
 *
 * @param host - Candidate host string.
 * @returns The 4 octets, or `undefined` if the host is not a plain IPv4 literal.
 */
function _parseIpv4(host: string): number[] | undefined
{
  const parts = host.split(".");
  if (parts.length !== 4)
  {
    return undefined;
  }
  const octets: number[] = [];
  for (const part of parts)
  {
    if (!/^\d{1,3}$/.test(part))
    {
      return undefined;
    }
    const value = Number(part);
    if (value > 255)
    {
      return undefined;
    }
    octets.push(value);
  }
  return octets;
}

/**
 * Decide whether an IPv4 address is in a private, loopback, link-local, reserved,
 * or cloud-metadata range.
 *
 * @param octets - The 4 octets of the address.
 * @returns `true` when the address must not be dialled.
 */
function _isPrivateIpv4(octets: number[]): boolean
{
  const [a, b] = octets;
  // 0.0.0.0/8 (this-network / unspecified) and 127.0.0.0/8 (loopback).
  if (a === 0 || a === 127)
  {
    return true;
  }
  // 10.0.0.0/8 private.
  if (a === 10)
  {
    return true;
  }
  // 172.16.0.0/12 private.
  if (a === 172 && b >= 16 && b <= 31)
  {
    return true;
  }
  // 192.168.0.0/16 private.
  if (a === 192 && b === 168)
  {
    return true;
  }
  // 169.254.0.0/16 link-local — includes the 169.254.169.254 cloud-metadata IP.
  if (a === 169 && b === 254)
  {
    return true;
  }
  // 100.64.0.0/10 carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127)
  {
    return true;
  }
  // 255.255.255.255 broadcast.
  if (octets.every(function _isMax(value) { return value === 255; }))
  {
    return true;
  }
  return false;
}

/**
 * Decide whether an IPv6 literal is loopback, unspecified, unique-local,
 * link-local, or an IPv4-mapped/compatible address that maps onto a private v4.
 *
 * @param host - The IPv6 host string (bracket-stripped, lowercased).
 * @returns `true` when the address must not be dialled.
 */
function _isPrivateIpv6(host: string): boolean
{
  const groups = _expandIpv6(host);
  if (groups === undefined)
  {
    // An IPv6-looking host we cannot parse fails closed.
    return true;
  }

  // 1. IPv4-mapped (::ffff:a.b.c.d) / IPv4-compatible — classify the embedded v4.
  const embedded = _embeddedIpv4(groups);
  if (embedded !== undefined)
  {
    return _isPrivateIpv4(embedded);
  }

  // 2. :: (unspecified) and ::1 (loopback).
  const isAllZero = groups.every(function _isZero(group) { return group === 0; });
  if (isAllZero)
  {
    return true;
  }
  if (groups.slice(0, 7).every(function _isZero(group) { return group === 0; }) && groups[7] === 1)
  {
    return true;
  }

  // 3. fc00::/7 unique-local and fe80::/10 link-local (+ fec0::/10 site-local).
  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00)
  {
    return true;
  }
  if ((first & 0xffc0) === 0xfe80)
  {
    return true;
  }
  if ((first & 0xffc0) === 0xfec0)
  {
    return true;
  }
  return false;
}

/**
 * Expand a (possibly compressed) IPv6 literal to exactly 8 16-bit groups.
 *
 * @param host - IPv6 literal, possibly containing a `::` run or trailing IPv4.
 * @returns The 8 groups, or `undefined` if the literal is malformed.
 */
function _expandIpv6(host: string): number[] | undefined
{
  // 1. A trailing dotted-quad (IPv4-mapped form) becomes two 16-bit groups.
  let work = host;
  let tail: number[] = [];
  const lastColon = work.lastIndexOf(":");
  const afterColon = work.slice(lastColon + 1);
  if (afterColon.includes("."))
  {
    const v4 = _parseIpv4(afterColon);
    if (v4 === undefined)
    {
      return undefined;
    }
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    work = work.slice(0, lastColon + 1) + "0:0";
  }

  // 2. Split on the "::" compression marker (at most one is permitted).
  const halves = work.split("::");
  if (halves.length > 2)
  {
    return undefined;
  }

  // 3. Parse each side and pad the gap left by "::" with zero groups.
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const rest = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const parsedHead = _parseHextets(head);
  const parsedRest = _parseHextets(rest);
  if (parsedHead === undefined || parsedRest === undefined)
  {
    return undefined;
  }
  const combinedRest = parsedRest.concat(tail);
  const total = parsedHead.length + combinedRest.length;

  if (halves.length === 2)
  {
    if (total > 8)
    {
      return undefined;
    }
    const gap = new Array<number>(8 - total).fill(0);
    return parsedHead.concat(gap, combinedRest);
  }

  return total === 8 ? parsedHead.concat(combinedRest) : undefined;
}

/**
 * Parse a list of hextet strings into numbers.
 *
 * @param parts - Colon-split hextet strings.
 * @returns Parsed 16-bit values, or `undefined` if any hextet is invalid.
 */
function _parseHextets(parts: string[]): number[] | undefined
{
  const values: number[] = [];
  for (const part of parts)
  {
    if (!/^[0-9a-f]{1,4}$/.test(part))
    {
      return undefined;
    }
    values.push(parseInt(part, 16));
  }
  return values;
}

/**
 * Extract the embedded IPv4 address from an IPv4-mapped (::ffff:0:0/96) or
 * IPv4-compatible (all-zero prefix) IPv6 group array.
 *
 * @param groups - The 8 expanded IPv6 groups.
 * @returns The embedded 4 octets, or `undefined` when the address is not v4-mapped.
 */
function _embeddedIpv4(groups: number[]): number[] | undefined
{
  const prefixZero = groups.slice(0, 5).every(function _isZero(group) { return group === 0; });
  if (!prefixZero)
  {
    return undefined;
  }
  // ::ffff:a.b.c.d (mapped) or ::a.b.c.d (compatible, non-zero tail).
  const mapped = groups[5] === 0xffff;
  const compatible = groups[5] === 0 && (groups[6] !== 0 || groups[7] !== 0);
  if (!mapped && !compatible)
  {
    return undefined;
  }
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
}
