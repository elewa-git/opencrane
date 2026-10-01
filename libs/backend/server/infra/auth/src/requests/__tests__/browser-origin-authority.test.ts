import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { _CreateRequestBrowserOriginAuthority, _HasSameOriginBrowserEvidence } from "../browser-origin-authority";

/** Creates the request surface used by the browser-origin authority. */
function _Request(headers: Readonly<Record<string, string>> = {}, protocol = "https"): Request
{
	const normalized = Object.fromEntries(Object.entries(headers).map(function _Normalize([name, value]) { return [name.toLowerCase(), value]; }));

	return {
		headers: normalized,
		protocol,
		get(name: string): string | undefined { return normalized[name.toLowerCase()]; },
	} as unknown as Request;
}

describe("same-origin browser request authority", function _Suite(): void
{
	it("admits matching Origin, Referer, or same-origin fetch metadata", function _AdmitsEvidence(): void
	{
		const expected = "https://opencrane.example";

		expect(_HasSameOriginBrowserEvidence(_Request({ origin: expected }), expected)).toBe(true);
		expect(_HasSameOriginBrowserEvidence(_Request({ referer: `${expected}/chats/one` }), expected)).toBe(true);
		expect(_HasSameOriginBrowserEvidence(_Request({ "sec-fetch-site": "same-origin" }), expected)).toBe(true);
	});

	it("rejects foreign, malformed, cross-site, and missing browser evidence", function _RejectsEvidence(): void
	{
		const expected = "https://opencrane.example";

		expect(_HasSameOriginBrowserEvidence(_Request({ origin: "https://attacker.example", referer: `${expected}/safe` }), expected)).toBe(false);
		expect(_HasSameOriginBrowserEvidence(_Request({ referer: "not-a-url" }), expected)).toBe(false);
		expect(_HasSameOriginBrowserEvidence(_Request({ "sec-fetch-site": "cross-site", origin: expected }), expected)).toBe(false);
		expect(_HasSameOriginBrowserEvidence(_Request(), expected)).toBe(false);
	});

	it("derives production origin from the forwarded host and proxy-aware protocol", function _UsesEffectiveAuthority(): void
	{
		const authority = _CreateRequestBrowserOriginAuthority();
		const forwarded = _Request({
			"host": "127.0.0.1:8080",
			"referer": "https://opencrane.example/chats/one",
			"sec-fetch-site": "same-origin",
			"x-forwarded-host": "opencrane.example",
		}, "https");

		expect(authority.isSameOrigin(forwarded)).toBe(true);
		expect(authority.isSameOrigin(_Request({ "sec-fetch-site": "same-origin" }))).toBe(false);
		expect(authority.isSameOrigin(_Request({ host: "opencrane.example", origin: "https://attacker.example" }))).toBe(false);
	});
});
