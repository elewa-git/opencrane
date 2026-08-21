import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { __IsSameOriginConversationSocketRequest } from "../conversation-socket-authenticator";

/** Build only the raw upgrade facts the same-origin policy reads. */
function _UpgradeRequest(headers: Record<string, string>, encrypted = false): IncomingMessage
{
	return { headers, socket: { encrypted } } as unknown as IncomingMessage;
}

describe("conversation socket origin policy", function _OriginPolicy()
{
	it("requires the public protocol as well as the public host", function _ExactOrigin()
	{
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "tenant.example", origin: "https://tenant.example", "x-forwarded-proto": "https" }))).toBe(true);
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "tenant.example", origin: "http://tenant.example", "x-forwarded-proto": "https" }))).toBe(false);
	});

	it("uses the trusted forwarded host and protocol behind the ingress", function _ForwardedOrigin()
	{
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "opencrane-server:8080", origin: "https://tenant.example", "x-forwarded-host": "tenant.example", "x-forwarded-proto": "https" }))).toBe(true);
		expect(__IsSameOriginConversationSocketRequest(_UpgradeRequest({ host: "opencrane-server:8080", origin: "https://tenant.example", "x-forwarded-host": "tenant.example", "x-forwarded-proto": "http" }))).toBe(false);
	});
});
