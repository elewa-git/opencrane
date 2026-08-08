import { defineConfig, devices } from "@playwright/test";

/** Fixed Storybook origin shared by the Nx static server and visual tests. */
const STORYBOOK_BASE_URL = "http://127.0.0.1:4400";

/** Deterministic Chromium configuration for committed component screenshots. */
export default defineConfig(
{
	testDir: "./tests/storybook",
	outputDir: "./.nx/test-results/storybook",
	snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	workers: 1,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	expect:
	{
		toHaveScreenshot:
		{
			animations: "disabled",
			caret: "hide",
			threshold: 0.2
		}
	},
	use:
	{
		baseURL: STORYBOOK_BASE_URL,
		colorScheme: "light",
		contextOptions:
		{
			reducedMotion: "reduce"
		},
		locale: "en-US",
		timezoneId: "UTC",
		trace: "retain-on-failure",
		viewport:
		{
			width: 1280,
			height: 900
		}
	},
	projects:
	[
		{
			name: "chromium",
			use:
			{
				...devices["Desktop Chrome"],
				browserName: "chromium",
				viewport:
				{
					width: 1280,
					height: 900
				}
			}
		}
	]
});
