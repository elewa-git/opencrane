import { defineConfig, devices } from "@playwright/test";

/** Playwright configuration for deterministic mock E2E and visual acceptance. */
export default defineConfig({
	testDir: "./src",
	outputDir: "../../dist/apps/opencrane-ui-e2e/results",
	snapshotPathTemplate: "{testDir}/visual-baselines/{projectName}/{arg}{ext}",
	reporter: [["html", { outputFolder: "../../dist/apps/opencrane-ui-e2e/report", open: "never" }], ["list"]],
	use:
	{
		baseURL: "http://127.0.0.1:4300",
		trace: "retain-on-failure",
		screenshot: "only-on-failure"
	},
	projects:
	[
		{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"], browserName: "chromium", viewport: { width: 1280, height: 800 } } },
		{ name: "tablet-chromium", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
		{ name: "mobile-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } }
	],
	webServer:
	{
		command: "npx nx serve opencrane-ui --configuration=mock --host=127.0.0.1 --port=4300",
		url: "http://127.0.0.1:4300",
		reuseExistingServer: !process.env["CI"],
		timeout: 120000
	},
	expect:
	{
		toHaveScreenshot: { animations: "disabled", maxDiffPixels: 0 }
	}
});
