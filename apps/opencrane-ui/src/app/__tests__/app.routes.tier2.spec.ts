// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stable URL-safe credential with the exact shape emitted by the Tier 2 launcher. */
const _CREDENTIAL = "a".repeat(43);

/** Loads the Tier 2 route table after a fresh evaluation of its tab-session bootstrap. */
async function _routes()
{
	vi.resetModules();
	const module = await import("../app.routes.tier2");

	return module.APP_ROUTES;
}

beforeEach(function _ResetBrowserState()
{
	window.sessionStorage.clear();
	window.history.replaceState({}, "", "/");
});

describe("Tier 2 browser entry routes", function _Tier2BrowserEntryRoutes()
{
	it("shows only the launcher guidance before this tab consumes a private URL", async function _MissingSession()
	{
		const routes = await _routes();

		expect(routes).toHaveLength(1);
		expect(routes[0]?.path).toBe("**");
		expect(routes[0]?.loadComponent).toBeTypeOf("function");
		expect(routes[0]?.canActivate).toBeUndefined();
	});

	it("restores the unchanged live routes after this tab consumes a private URL", async function _AdmittedSession()
	{
		window.history.replaceState({}, "", `/?development-session=${_CREDENTIAL}`);
		const routes = await _routes();
		const paths = routes.map(function _RoutePath(route) { return route.path; });

		expect(paths).toContain("login");
		expect(paths).toContain("onboarding");
		expect(paths).toContain("chats");
		expect(paths.at(-1)).toBe("**");
		expect(window.location.search).toBe("");
	});
});
