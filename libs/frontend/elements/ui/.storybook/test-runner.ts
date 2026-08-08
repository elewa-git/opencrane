import type { TestRunnerConfig } from "@storybook/test-runner";
import { checkA11y, injectAxe } from "axe-playwright";

/** Interaction runner hooks that make accessibility violations fail the story test. */
const config: TestRunnerConfig =
{
	async preVisit(page): Promise<void>
	{
		await injectAxe(page);
	},
	async postVisit(page): Promise<void>
	{
		await checkA11y(
			page,
			"#storybook-root",
			{
				detailedReport: true,
				detailedReportOptions:
				{
					html: true
				}
			},
			false,
			"v2"
		);
	}
};

export default config;
