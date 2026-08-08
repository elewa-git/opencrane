import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

import type { StorybookIndex, StorybookIndexEntry } from "./storybook.visual.types.js";

/** Opt-in tag that marks a deterministic story as a committed visual contract. */
const VISUAL_TEST_TAG = "visual-test";

/** Attribute for small controls that need a strict local pixel budget. */
const VISUAL_TARGET_ATTRIBUTE = "data-visual-target";

/** Whole-story tolerance for platform-specific font rasterization. */
const STORY_MAX_DIFF_PIXEL_RATIO = 0.005;

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

/**
 * Captures one story in a fresh page so Angular teardown from another story cannot race its root.
 * @param context - Deterministic Chromium context shared by the visual contract.
 * @param story - Indexed story whose stable ID names the screenshot.
 */
async function _CaptureStory(context: BrowserContext, story: StorybookIndexEntry): Promise<void>
{
	const page = await context.newPage();

	try
	{
		await _OpenStableStory(page, story.id);
		await expect(page.locator("#storybook-root")).toHaveScreenshot(`${story.id}.png`,
		{
			maxDiffPixelRatio: STORY_MAX_DIFF_PIXEL_RATIO
		});
		await _AssertVisualTargets(page, story.id);
	}
	finally
	{
		await page.close();
	}
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
		await expect(target).toHaveScreenshot(`${storyId}--${targetName}.png`,
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
	// 1. Load the isolated story canvas so Storybook manager chrome cannot affect the baseline.
	const response = await page.goto(`/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`,
	{
		waitUntil: "networkidle"
	});
	expect(response?.ok(), `Story ${storyId} failed to load`).toBe(true);

	// 2. Suppress residual transitions because the design system includes intentional paper motion.
	await page.addStyleTag({ content: STABLE_SCREENSHOT_CSS });

	// 3. Wait for local font files and the Angular render to settle before comparing pixels.
	await page.evaluate(async () => document.fonts.ready);
	await expect(page.locator("#storybook-root")).not.toBeEmpty({ timeout: 15_000 });
}
