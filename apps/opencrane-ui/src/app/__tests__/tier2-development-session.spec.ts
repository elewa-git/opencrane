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

beforeEach(function _ResetBrowserState()
{
	window.sessionStorage.clear();
	window.localStorage.clear();
	window.history.replaceState({}, "", "/");
});

describe("Tier 2 browser development session", function _Tier2DevelopmentSessionSuite()
{
	it("keeps a supplied credential in this tab and removes only its query value", async function _ConsumePrivateUrl()
	{
		window.history.replaceState({}, "", `/?view=onboarding&development-session=${_CREDENTIAL}#question`);

		await expect(_credential()).resolves.toBe(_CREDENTIAL);
		expect(window.location.pathname).toBe("/");
		expect(window.location.search).toBe("?view=onboarding");
		expect(window.location.hash).toBe("#question");
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
		window.history.replaceState({}, "", "/?development-session=not-a-launch-credential");

		await expect(_credential()).resolves.toBeNull();
		expect(window.location.search).toBe("");
		expect(window.sessionStorage.getItem("opencrane.tier2.development-session")).toBeNull();
		expect(window.localStorage.getItem("opencrane.tier2.development-session")).toBe(_CREDENTIAL);
	});
});
