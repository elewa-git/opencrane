import { Page } from "@playwright/test";

/** Supported deterministic UI mock scenario names. */
export enum UiMockScenario
{
	/** Populated happy path. */
	Default = "default",
	/** Empty list and content state. */
	Empty = "empty",
	/** Deferred read and mutation state. */
	Loading = "loading",
	/** Recoverable failure state. */
	Error = "error",
	/** Restricted member presentation. */
	Permission = "permission",
	/** Budget and capacity thresholds. */
	Limits = "limits",
	/** Session transport-loss presentation. */
	Offline = "offline",
	/** Wrapping and overflow stress state. */
	LongContent = "long-content"
}

/** Supported deterministic route-access modes. */
export enum UiMockAccessMode
{
	/** Authenticated administrator with an active tenant. */
	Administrator = "administrator",
	/** Authenticated member with an active tenant. */
	Member = "member",
	/** Anonymous visitor redirected to sign in. */
	Anonymous = "anonymous",
	/** Authenticated visitor redirected to the no-tenant route. */
	NoTenant = "no-tenant",
	/** Authenticated visitor redirected through first-run onboarding. */
	FirstRun = "first-run"
}

/**
 * Opens a route with a deterministic mock scenario selected through the query string.
 * @param page - Playwright page controlled by the current test.
 * @param path - Application route to open.
 * @param scenario - Named mock scenario to activate.
 */
export async function _OpenMockScenario(page: Page, path: string, scenario: UiMockScenario): Promise<void>
{
	await page.goto(`${path}?mockScenario=${scenario}`);
}

/**
 * Opens a route with deterministic content and route-access modes.
 * @param page - Playwright page controlled by the current test.
 * @param path - Application route to open.
 * @param scenario - Named mock content scenario to activate.
 * @param accessMode - Named mock access mode to activate.
 */
export async function _OpenMockAccess(page: Page, path: string, scenario: UiMockScenario, accessMode: UiMockAccessMode): Promise<void>
{
	await page.goto(`${path}?mockScenario=${scenario}&mockAccess=${accessMode}`);
}
