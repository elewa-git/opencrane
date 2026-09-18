// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stable URL-safe credential with the exact shape emitted by the Tier 2 launcher. */
const _CREDENTIAL = "a".repeat(43);

/** Loads the browser credential after a fresh evaluation of the Tier 2 bootstrap module. */
async function _credential(): Promise<string | null>
{
	vi.resetModules();
	const module = await import("../local-development/tier2-development-session");

	return module.OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL;
}

/** Loads the complete Tier 2 browser-session coordinator after a fresh evaluation. */
async function _sessionModule()
{
	vi.resetModules();
	return import("../local-development/tier2-development-session");
}

beforeEach(function _ResetBrowserState()
{
	window.sessionStorage.clear();
	window.localStorage.clear();
	window.history.replaceState({}, "", "/");
});

describe("Tier 2 browser development session", function _Tier2DevelopmentSessionSuite()
{
	it("keeps a supplied credential in this tab and removes its URL fragment", async function _ConsumePrivateUrl()
	{
		window.history.replaceState({}, "", `/?view=onboarding#development-session=${_CREDENTIAL}`);

		await expect(_credential()).resolves.toBe(_CREDENTIAL);
		expect(window.location.pathname).toBe("/");
		expect(window.location.search).toBe("?view=onboarding");
		expect(window.location.hash).toBe("");
		expect(window.sessionStorage.getItem("opencrane.tier2.development-session")).toBe(_CREDENTIAL);
	});

	it("admits a later plain URL from session storage", async function _ReuseSessionCredential()
	{
		window.sessionStorage.setItem("opencrane.tier2.development-session", _CREDENTIAL);

		await expect(_credential()).resolves.toBe(_CREDENTIAL);
	});

	it("clears malformed supplied and stored values without consulting local storage", async function _RejectMalformedCredentials()
	{
		window.sessionStorage.setItem("opencrane.tier2.development-session", _CREDENTIAL);
		window.localStorage.setItem("opencrane.tier2.development-session", _CREDENTIAL);
		window.history.replaceState({}, "", "/#development-session=not-a-launch-credential&unexpected=value");

		await expect(_credential()).resolves.toBeNull();
		expect(window.location.hash).toBe("");
		expect(window.sessionStorage.getItem("opencrane.tier2.development-session")).toBeNull();
		expect(window.localStorage.getItem("opencrane.tier2.development-session")).toBe(_CREDENTIAL);
	});

	it("records a replaced launch without retaining the obsolete credential and replaces once", async function _ReplaceObsoleteSession()
	{
		window.sessionStorage.setItem("opencrane.tier2.development-session", _CREDENTIAL);
		window.history.replaceState({}, "", "/chats/conversation-1?panel=activity");
		const module = await _sessionModule();
		const replaceDocument = vi.fn();

		module._ReplaceTier2DevelopmentSession(replaceDocument);
		module._ReplaceTier2DevelopmentSession(replaceDocument);

		expect(window.sessionStorage.getItem("opencrane.tier2.development-session")).toBeNull();
		expect(window.sessionStorage.getItem("opencrane.tier2.development-session-guidance")).toBe("replaced");
		expect(replaceDocument).toHaveBeenCalledOnce();
		expect(replaceDocument).toHaveBeenCalledWith("/chats/conversation-1?panel=activity");
	});

	it("clears replaced guidance when a valid private URL is consumed", async function _NewLaunchWins()
	{
		window.sessionStorage.setItem("opencrane.tier2.development-session-guidance", "replaced");
		window.history.replaceState({}, "", `/#development-session=${_CREDENTIAL}`);
		const module = await _sessionModule();

		expect(module.OPENCRANE_TIER2_DEVELOPMENT_SESSION_CREDENTIAL).toBe(_CREDENTIAL);
		expect(module.OPENCRANE_TIER2_DEVELOPMENT_SESSION_GUIDANCE_STATE).toBe("missing");
		expect(window.sessionStorage.getItem("opencrane.tier2.development-session-guidance")).toBeNull();
	});
});
