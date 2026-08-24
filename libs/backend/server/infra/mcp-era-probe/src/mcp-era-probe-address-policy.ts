import { isIP } from "node:net";

import type { McpEraProbeDnsAddress } from "./mcp-era-probe.types";
import { McpEraProbeConfigurationError } from "./mcp-era-probe.errors";

/** Return whether an IPv4 address avoids every non-public special-purpose range. */
function _IsPublicIpv4(address: string): boolean
{
	const parts = address.split(".");
	if (parts.length !== 4)
		return false;
	const octets = parts.map(function _ParseOctet(part) { return /^\d{1,3}$/u.test(part) ? Number(part) : Number.NaN; });
	if (octets.some(function _InvalidOctet(octet) { return !Number.isInteger(octet) || octet < 0 || octet > 255; }))
		return false;
	const first = octets[0] as number;
	const second = octets[1] as number;
	const third = octets[2] as number;
	if (first === 0 || first === 10 || first === 127 || first >= 224)
		return false;
	if (first === 100 && second >= 64 && second <= 127)
		return false;
	if (first === 169 && second === 254)
		return false;
	if (first === 172 && second >= 16 && second <= 31)
		return false;
	if (first === 192 && second === 0)
		return false;
	if (first === 192 && second === 168)
		return false;
	if (first === 192 && second === 88 && third === 99)
		return false;
	if (first === 198 && (second === 18 || second === 19))
		return false;
	if (first === 198 && second === 51 && third === 100)
		return false;
	if (first === 203 && second === 0 && third === 113)
		return false;
	return true;
}

/** Expand one valid IPv6 address into eight numeric groups. */
function _Ipv6Groups(address: string): readonly number[] | null
{
	if (address.includes("%"))
		return null;
	const split = address.split("::");
	if (split.length > 2)
		return null;
	const left = split[0] === "" ? [] : (split[0] as string).split(":");
	const right = split.length === 1 || split[1] === "" ? [] : (split[1] as string).split(":");
	const groups = [...left, ...right];
	if (groups.some(function _InvalidGroup(group) { return !/^[0-9a-f]{1,4}$/iu.test(group); }))
		return null;
	if (split.length === 1 && groups.length !== 8)
		return null;
	if (split.length === 2 && groups.length >= 8)
		return null;
	const values = groups.map(function _ParseGroup(group) { return Number.parseInt(group, 16); });
	if (split.length === 2)
		values.splice(left.length, 0, ...Array.from({ length: 8 - groups.length }, function _Zero() { return 0; }));
	return values.length === 8 ? values : null;
}

/** Return whether an IPv6 address is public global unicast and not a reserved subrange. */
function _IsPublicIpv6(address: string): boolean
{
	const groups = _Ipv6Groups(address);
	if (groups === null)
		return false;
	const first = groups[0] as number;
	const second = groups[1] as number;
	if (first < 0x2000 || first > 0x3fff)
		return false;
	if (first === 0x2001 && second <= 0x01ff)
		return false;
	if (first === 0x2001 && second === 0x0db8)
		return false;
	if (first === 0x2002)
		return false;
	if (first === 0x3fff && (second & 0xf000) === 0)
		return false;
	return true;
}

/** Return whether one resolver result may be used for an outbound MCP connection. */
export function _McpEraProbeIsPublicAddress(address: McpEraProbeDnsAddress): boolean
{
	if (address.family === 4)
		return isIP(address.address) === 4 && _IsPublicIpv4(address.address);
	return isIP(address.address) === 6 && _IsPublicIpv6(address.address);
}

/** Parse the one direct HTTPS endpoint admitted by the transport. */
export function _McpEraProbeEndpoint(value: string): URL
{
	let endpoint: URL;
	try { endpoint = new URL(value); }
	catch { throw new McpEraProbeConfigurationError("invalid_endpoint"); }
	const hostname = endpoint.hostname.startsWith("[") && endpoint.hostname.endsWith("]") ? endpoint.hostname.slice(1, -1) : endpoint.hostname;
	if (endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" || endpoint.hash !== "" || endpoint.search !== "" || isIP(hostname) !== 0)
		throw new McpEraProbeConfigurationError("invalid_endpoint");
	return endpoint;
}
