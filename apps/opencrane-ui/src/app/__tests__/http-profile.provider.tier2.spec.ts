// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Loads the Tier 2 response classifier with a fresh idempotency fence. */
async function _handler()
{
	vi.resetModules();
	const module = await import("../http-profile.provider.tier2");

	return module._HandleTier2UnauthorizedResponse;
}

beforeEach(function _ResetBrowserState()
{
	window.sessionStorage.clear();
	window.history.replaceState({}, "", "/chats/conversation-1");
});

describe("Tier 2 unauthorized response handling", function _Tier2UnauthorizedResponseSuite()
{
	it("replaces the obsolete tab only for the exact development-session response", async function _DevelopmentSessionRequired()
	{
		const handler = await _handler();
		const replaceDocument = vi.fn();
		const response = new Response(JSON.stringify({ code: "DEVELOPMENT_SESSION_REQUIRED", error: "Development session required." }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});

		await expect(handler(response, replaceDocument)).resolves.toBe(true);
		expect(replaceDocument).toHaveBeenCalledWith("/chats/conversation-1");
		expect(window.sessionStorage.getItem("opencrane.tier2.development-session-guidance")).toBe("replaced");
	});

	it.each([
		new Response(JSON.stringify({ code: "MEMBERSHIP_REQUIRED" }), { status: 401 }),
		new Response(JSON.stringify({ code: "DEVELOPMENT_ORIGIN_MISMATCH" }), { status: 403 }),
		new Response("not-json", { status: 401 }),
	])("leaves unrelated authentication, origin, and malformed responses unclaimed", async function _UnclaimedResponse(response)
	{
		const handler = await _handler();
		const replaceDocument = vi.fn();

		await expect(handler(response, replaceDocument)).resolves.toBe(false);
		expect(replaceDocument).not.toHaveBeenCalled();
		expect(window.sessionStorage.getItem("opencrane.tier2.development-session-guidance")).toBeNull();
	});
});
