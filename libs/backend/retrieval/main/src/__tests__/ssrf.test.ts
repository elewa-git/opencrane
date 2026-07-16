import { describe, expect, it } from "vitest";

import { UnsafeRemoteUrlError, _AssertResolvedHostSafe, _AssertSafeRemoteUrl } from "../core/ssrf.js";
import type { HostLookup } from "../core/ssrf.types.js";

/**
 * SSRF / unsafe-network guard (italanta/opencrane#128, folded #218). Every remote
 * URL from an external registry is attacker-influenced, so the guard must fail
 * closed: only https to a routable public host passes.
 */
describe("_AssertSafeRemoteUrl", function _suite()
{
  it("accepts https to a public host and returns the parsed URL", function ()
  {
    const url = _AssertSafeRemoteUrl("https://mcp.example.com/v1/stream");
    expect(url.hostname).toBe("mcp.example.com");
  });

  it("rejects non-https schemes", function ()
  {
    expect(() => _AssertSafeRemoteUrl("http://mcp.example.com")).toThrow(UnsafeRemoteUrlError);
    expect(() => _AssertSafeRemoteUrl("ftp://mcp.example.com")).toThrow(UnsafeRemoteUrlError);
    expect(() => _AssertSafeRemoteUrl("file:///etc/passwd")).toThrow(UnsafeRemoteUrlError);
  });

  it("rejects malformed URLs", function ()
  {
    expect(() => _AssertSafeRemoteUrl("not a url")).toThrow(UnsafeRemoteUrlError);
    expect(() => _AssertSafeRemoteUrl("")).toThrow(UnsafeRemoteUrlError);
  });

  it("rejects embedded credentials", function ()
  {
    expect(() => _AssertSafeRemoteUrl("https://user:pass@mcp.example.com")).toThrow(UnsafeRemoteUrlError);
  });

  it("rejects loopback and private IPv4 literals", function ()
  {
    for (const host of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "172.31.255.255", "0.0.0.0", "100.64.0.1"])
    {
      expect(() => _AssertSafeRemoteUrl(`https://${host}/x`), host).toThrow(UnsafeRemoteUrlError);
    }
  });

  it("rejects the cloud-metadata link-local IP", function ()
  {
    expect(() => _AssertSafeRemoteUrl("https://169.254.169.254/latest/meta-data/")).toThrow(/private\/reserved IPv4/);
  });

  it("allows a public IPv4 literal", function ()
  {
    expect(() => _AssertSafeRemoteUrl("https://8.8.8.8/x")).not.toThrow();
  });

  it("rejects loopback, unique-local, link-local and IPv4-mapped IPv6 literals", function ()
  {
    for (const host of ["[::1]", "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]", "[::]"])
    {
      expect(() => _AssertSafeRemoteUrl(`https://${host}/x`), host).toThrow(UnsafeRemoteUrlError);
    }
  });

  it("allows a public IPv6 literal", function ()
  {
    expect(() => _AssertSafeRemoteUrl("https://[2606:4700:4700::1111]/x")).not.toThrow();
  });

  it("rejects reserved local/metadata hostnames and internal suffixes", function ()
  {
    for (const host of ["localhost", "metadata.google.internal", "db.internal", "svc.local", "app.localhost"])
    {
      expect(() => _AssertSafeRemoteUrl(`https://${host}/x`), host).toThrow(UnsafeRemoteUrlError);
    }
  });
});

describe("_AssertResolvedHostSafe — DNS-resolution guard (rebinding / private-resolving names)", function _resolveSuite()
{
  /** A lookup stub returning fixed addresses for the tested host. */
  function _lookup(addresses: string[]): HostLookup
  {
    return async function _l() { return addresses.map(function _m(address) { return { address }; }); };
  }

  it("passes when every resolved address is public", async function _public()
  {
    await expect(_AssertResolvedHostSafe("registry.example.com", _lookup(["93.184.216.34"]))).resolves.toBeUndefined();
  });

  it("rejects a public-looking host that resolves to a private/loopback/metadata address", async function _private()
  {
    for (const addr of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1"])
    {
      await expect(_AssertResolvedHostSafe("sneaky.example.com", _lookup([addr])), addr).rejects.toBeInstanceOf(UnsafeRemoteUrlError);
    }
  });

  it("rejects when ANY resolved address is unsafe (mixed public + private)", async function _mixed()
  {
    await expect(_AssertResolvedHostSafe("rebind.example.com", _lookup(["93.184.216.34", "169.254.169.254"]))).rejects.toBeInstanceOf(UnsafeRemoteUrlError);
  });
});
