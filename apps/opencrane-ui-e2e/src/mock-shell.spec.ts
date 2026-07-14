import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { UiMockAccessMode, UiMockScenario, _OpenMockAccess, _OpenMockScenario } from "./support/mock-scenario.js";

/** Complete content scenario list exercised by every viewport project. */
const CONTENT_SCENARIOS = Object.values(UiMockScenario);

test("opens the mock workspace without OIDC", async function _OpenWorkspace({ page })
{
	await _OpenMockScenario(page, "/", UiMockScenario.Default);
	await expect(page.getByRole("main")).toBeVisible();
	await expect(page).not.toHaveURL(/login|no-tenant|welcome/);
});

test("has no automatically detectable accessibility violations", async function _AuditWorkspace({ page })
{
	await _OpenMockScenario(page, "/", UiMockScenario.Default);
	const results = await new AxeBuilder({ page }).analyze();
	expect(results.violations).toEqual([]);
});

CONTENT_SCENARIOS.forEach(function _RegisterScenarioTest(scenario: UiMockScenario): void
{
	test(`renders the ${scenario} content scenario without a page error`, async function _RenderScenario({ page })
	{
		const pageErrors: Error[] = [];
		page.on("pageerror", function _CapturePageError(error: Error): void
		{
			pageErrors.push(error);
		});
		await _OpenMockScenario(page, "/", scenario);
		await expect(page.getByRole("main")).toBeVisible();
		expect(pageErrors).toEqual([]);
	});
});

test("redirects anonymous access to sign in", async function _RedirectAnonymous({ page })
{
	await _OpenMockAccess(page, "/", UiMockScenario.Default, UiMockAccessMode.Anonymous);
	await expect(page).toHaveURL(/\/login$/);
});

test("redirects tenantless access to the terminal route", async function _RedirectTenantless({ page })
{
	await _OpenMockAccess(page, "/", UiMockScenario.Default, UiMockAccessMode.NoTenant);
	await expect(page).toHaveURL(/\/no-tenant$/);
});

test("redirects first-run access to onboarding", async function _RedirectFirstRun({ page })
{
	await _OpenMockAccess(page, "/", UiMockScenario.Default, UiMockAccessMode.FirstRun);
	await expect(page).toHaveURL(/\/welcome$/);
});

test("keeps member access inside the workspace", async function _KeepMemberWorkspace({ page })
{
	await _OpenMockAccess(page, "/", UiMockScenario.Default, UiMockAccessMode.Member);
	await expect(page.getByRole("main")).toBeVisible();
	await expect(page).not.toHaveURL(/login|no-tenant|welcome/);
});

test("captures the shared shell baseline @visual", async function _CaptureShell({ page })
{
	await _OpenMockScenario(page, "/", UiMockScenario.Default);
	await expect(page).toHaveScreenshot("shared-shell.png", { fullPage: true });
});
