import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

import type { StorybookIndex, StorybookIndexEntry } from "./storybook.visual.types.js";

/** Opt-in tag that marks a deterministic story as a committed visual contract. */
const VISUAL_TEST_TAG = "visual-test";

/** Opt-in tag that captures a visual contract at the supported narrow viewport. */
const VISUAL_NARROW_TAG = "visual-test-narrow";

/** Opt-in tag that requires the shared journey canvas to cover the browser viewport. */
const VISUAL_FULL_VIEWPORT_TAG = "visual-test-full-viewport";

/** Supported narrow browser viewport used for responsive state contracts. */
const VISUAL_NARROW_VIEWPORT = { width: 390, height: 844 } as const;

/** Attribute for small controls that need a strict local pixel budget. */
const VISUAL_TARGET_ATTRIBUTE = "data-visual-target";

/** Whole-story tolerance for platform-specific font rasterization. */
const STORY_MAX_DIFF_PIXEL_RATIO = 0.005;

/** Story-specific viewport overrides for canonical responsive contracts. */
const STORY_VIEWPORTS: ReadonlyMap<string, { readonly width: number; readonly height: number }> = new Map([
	["features-persona-onboarding-states--introduction", { width: 1705, height: 813 }],
	["onboarding-persona-first-chat--narrow-long-content", { width: 390, height: 844 }],
]);

/** Tight absolute budget for a deliberately isolated control screenshot. */
const TARGET_MAX_DIFF_PIXELS = 25;

/** CSS injected after rendering so transient motion cannot change captured pixels. */
const STABLE_SCREENSHOT_CSS = `
	*, *::before, *::after {
		animation: none !important;
		caret-color: transparent !important;
		transition: none !important;
	}
`;

test("tagged component states match their committed screenshots", async ({ context, request }) =>
{
	// 1. Discover explicit visual contracts from the built catalogue so new tagged stories cannot escape coverage.
	const stories = await _LoadVisualStories(request);
	expect(stories.length, "Storybook must expose at least one visual-test story").toBeGreaterThan(0);

	// 2. Capture each story in stable ID order so failures and baseline updates remain reproducible.
	for (const story of stories)
	{
		await _CaptureStory(context, story);
	}
});

test("intermediate conversation workspace keeps its rail and context inside the viewport", async ({ page }) =>
{
	for (const viewport of [{ width: 1073, height: 900 }, { width: 1768, height: 900 }])
	{
		await page.setViewportSize(viewport);
		await _OpenStableStory(page, "conversations-workspace-shell--long-content");

		const routeHost = page.locator("wo-conversation-workspace-route");
		const pageHost = page.locator("wo-conversation-workspace-page");
		const workspace = page.locator(".conversation-workspace");
		const rail = page.locator("wo-conversation-list");
		const contextPanel = page.locator("wo-conversation-workspace-context-panel");
		const header = page.locator(".conversation-workspace__header");
		const transcript = page.locator(".conversation-workspace__transcript");
		const composer = page.locator(".conversation-workspace__composer");
		const railFooter = page.locator(".conversation-list__identity");
		await expect(routeHost).toHaveCount(1);
		await expect(pageHost).toHaveCount(1);
		await expect(workspace).toHaveCount(1);
		await expect(rail).toHaveCount(1);
		await expect(contextPanel).toHaveCount(1);
		await expect(header).toHaveCount(1);
		await expect(transcript).toHaveCount(1);
		await expect(composer).toHaveCount(1);
		await expect(railFooter).toHaveCount(1);

		const routeHostBox = await routeHost.boundingBox();
		const pageHostBox = await pageHost.boundingBox();
		const workspaceBox = await workspace.boundingBox();
		const railBox = await rail.boundingBox();
		const contextPanelBox = await contextPanel.boundingBox();
		const headerBox = await header.boundingBox();
		const composerBox = await composer.boundingBox();
		const railFooterBox = await railFooter.boundingBox();
		if (routeHostBox === null || pageHostBox === null || workspaceBox === null || railBox === null || contextPanelBox === null || headerBox === null || composerBox === null || railFooterBox === null) throw new Error("The routed workspace layout is not visible.");

		expect(Math.round(routeHostBox.height)).toBe(viewport.height);
		expect(Math.round(pageHostBox.height)).toBe(viewport.height);
		expect(Math.round(workspaceBox.height)).toBe(viewport.height);
		expect(Math.round(railBox.height)).toBe(viewport.height);
		expect(contextPanelBox.x).toBeGreaterThanOrEqual(railBox.width);
		expect(Math.round(contextPanelBox.y + contextPanelBox.height)).toBeLessThanOrEqual(viewport.height);
		expect(Math.round(headerBox.y)).toBe(0);
		expect(Math.round(composerBox.y + composerBox.height)).toBe(viewport.height);
		expect(Math.round(railFooterBox.y + railFooterBox.height)).toBe(viewport.height);
		expect(await transcript.evaluate(function _OwnsScroll(element) { return element.scrollHeight > element.clientHeight; })).toBe(true);
		expect(await page.locator("html").evaluate(function _DoesNotScroll(element) { return element.scrollHeight <= element.clientHeight; })).toBe(true);
	}
});

test("conversation workspace visual contracts cover the observed widths", async ({ page }) =>
{
	for (const contract of [{ storyId: "conversations-workspace-shell--intermediate-long-content", width: 1073 }, { storyId: "conversations-workspace-shell--wide-long-content", width: 1768 }])
	{
		await page.setViewportSize({ width: contract.width, height: 900 });
		await _OpenStableStory(page, contract.storyId);
		await expect(page.locator("#storybook-root")).toHaveScreenshot(`${contract.storyId}.png`, { maxDiffPixelRatio: STORY_MAX_DIFF_PIXEL_RATIO });
	}
});

/**
 * Captures one story in a fresh page so Angular teardown from another story cannot race its root.
 * @param context - Deterministic Chromium context shared by the visual contract.
 * @param story - Indexed story whose stable ID names the screenshot.
 */
async function _CaptureStory(context: BrowserContext, story: StorybookIndexEntry): Promise<void>
{
	const page = await context.newPage();
	const viewport = story.tags?.includes(VISUAL_NARROW_TAG) ? VISUAL_NARROW_VIEWPORT : STORY_VIEWPORTS.get(story.id);

	try
	{
		// 1. Apply the story's responsive contract before navigation so layout starts deterministically.
		if (viewport !== undefined)
		{
			await page.setViewportSize(viewport);
		}

		// 2. Wait for the shared stable-render prerequisites before any pixel comparison.
		await _OpenStableStory(page, story.id);
		if (story.tags?.includes(VISUAL_FULL_VIEWPORT_TAG)) await _AssertFullViewportJourney(page);
		// 3. Capture the complete feature composition against this platform's reviewed baseline.
		await expect.soft(page.locator("#storybook-root")).toHaveScreenshot(`${story.id}.png`,
		{
			maxDiffPixelRatio: STORY_MAX_DIFF_PIXEL_RATIO
		});

		// 4. Enforce strict local budgets for small controls that a whole-story ratio could hide.
		await _AssertVisualTargets(page, story.id);
	}
	finally
	{
		await page.close();
	}
}

/** Prove a short journey owns at least the full visible viewport without fixing its content height. */
async function _AssertFullViewportJourney(page: Page): Promise<void>
{
	const journey = page.locator(".wo-journey");
	await expect(journey).toHaveCount(1);
	const journeyHeight = await journey.evaluate(function _JourneyHeight(element) { return element.getBoundingClientRect().height; });
	const viewportHeight = await page.evaluate(function _ViewportHeight() { return window.innerHeight; });
	expect(journeyHeight, "Journey canvas must cover the full browser viewport").toBeGreaterThanOrEqual(viewportHeight);
}

/**
 * Compares isolated controls with an absolute pixel budget so they cannot hide in a large canvas.
 * @param page - Chromium page containing the stable story.
 * @param storyId - Stable Storybook story identifier used to namespace snapshots.
 */
async function _AssertVisualTargets(page: Page, storyId: string): Promise<void>
{
	const targets = page.locator(`[${VISUAL_TARGET_ATTRIBUTE}]`);
	const count = await targets.count();

	for (let index = 0; index < count; index += 1)
	{
		const target = targets.nth(index);
		const targetName = await target.getAttribute(VISUAL_TARGET_ATTRIBUTE);
		expect(targetName, `${VISUAL_TARGET_ATTRIBUTE} must name each strict contract`).toMatch(/^[a-z0-9-]+$/u);
		await expect.soft(target).toHaveScreenshot(`${storyId}--${targetName}.png`,
		{
			maxDiffPixels: TARGET_MAX_DIFF_PIXELS
		});
	}
}

/**
 * Loads the static Storybook index and returns only explicitly tagged visual contracts.
 * @param request - Playwright request client configured with the Storybook base URL.
 * @returns Stable-ID-sorted rendered story entries.
 */
async function _LoadVisualStories(request: APIRequestContext): Promise<readonly StorybookIndexEntry[]>
{
	const response = await request.get("/index.json");
	expect(response.ok(), `Storybook index request failed with ${response.status()}`).toBe(true);

	const index = await response.json() as StorybookIndex;

	return Object.values(index.entries)
		.filter((entry) => entry.type === "story" && entry.tags?.includes(VISUAL_TEST_TAG))
		.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Renders one story and waits for its deterministic visual prerequisites.
 * @param page - Chromium page used for the screenshot contract.
 * @param storyId - Stable Storybook story identifier.
 */
async function _OpenStableStory(page: Page, storyId: string): Promise<void>
{
	// 1. Load only through DOM readiness; Storybook background requests make network-idle both slow
	// and unrelated to visual stability. The root and local fonts below are the actual prerequisites.
	const response = await page.goto(`/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`,
	{
		waitUntil: "domcontentloaded"
	});
	expect(response?.ok(), `Story ${storyId} failed to load`).toBe(true);

	// 2. Suppress residual transitions because the design system includes intentional paper motion.
	await page.addStyleTag({ content: STABLE_SCREENSHOT_CSS });

	// 3. Wait for local fonts and Angular to settle. Workspace stories also wait for their route to leave loading,
	// because CI captured their loading screen before the selected conversation rendered.
	await page.evaluate(async () => document.fonts.ready);
	await expect(page.locator("#storybook-root")).not.toBeEmpty({ timeout: 15_000 });
	if (storyId.startsWith("conversations-workspace-shell--")) await expect(page.locator(".conversation-workspace:not([data-route-state=\"loading\"])")).toHaveCount(1, { timeout: 15_000 });
}
