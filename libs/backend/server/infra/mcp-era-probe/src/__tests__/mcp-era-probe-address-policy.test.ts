import { describe, expect, it } from "vitest";

import { _McpEraProbeIsPublicAddress } from "../mcp-era-probe-address-policy";

describe("MCP era-probe address policy", function _AddressPolicySuite()
{
	it.each([
		"0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
		"192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.51.100.1",
		"203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
	])("rejects reserved IPv4 address %s", function _RejectsIpv4(address)
	{
		expect(_McpEraProbeIsPublicAddress({ address, family: 4 })).toBe(false);
	});

	it.each([
		"::", "::1", "::ffff:192.168.1.1", "64:ff9b::c0a8:101", "100::1", "2001::1", "2001:db8::1",
		"2002::1", "3fff::1", "fc00::1", "fe80::1", "ff00::1",
	])("rejects reserved IPv6 address %s", function _RejectsIpv6(address)
	{
		expect(_McpEraProbeIsPublicAddress({ address, family: 6 })).toBe(false);
	});

	it.each([
		{ address: "8.8.8.8", family: 4 as const },
		{ address: "1.1.1.1", family: 4 as const },
		{ address: "2606:4700:4700::1111", family: 6 as const },
		{ address: "2a00:1450:4009:80b::200e", family: 6 as const },
	])("accepts public address $address", function _AcceptsPublic(address)
	{
		expect(_McpEraProbeIsPublicAddress(address)).toBe(true);
	});
});
