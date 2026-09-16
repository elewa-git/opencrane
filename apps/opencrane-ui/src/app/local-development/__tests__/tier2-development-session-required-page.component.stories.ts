import type { Meta, StoryObj } from "@storybook/angular";

import { Tier2DevelopmentSessionRequiredPageComponent } from "../tier2-development-session-required-page.component";

/** Storybook metadata for the Tier 2 private-browser-session handoff. */
const meta: Meta<Tier2DevelopmentSessionRequiredPageComponent> =
{
	title: "Local development/Tier 2 session required",
	component: Tier2DevelopmentSessionRequiredPageComponent,
	tags: ["autodocs"],
	parameters:
	{
		docs:
		{
			description:
			{
				component: "The Tier 2-only entry page shown when this page session has no credential from the private URL printed by its current launcher. It displays no credential and performs no authentication request."
			}
		}
	}
};

export default meta;

/** Local story type for the fixed missing-session state. */
type Story = StoryObj<Tier2DevelopmentSessionRequiredPageComponent>;

/** Desktop state for a page session that has no current launcher credential. */
export const MissingBrowserSession: Story =
{
	tags: ["visual-test", "visual-test-full-viewport"]
};

/** Narrow state proving that missing-session guidance fits a supported mobile viewport. */
export const MissingBrowserSessionNarrow: Story =
{
	tags: ["visual-test", "visual-test-full-viewport", "visual-test-narrow"]
};
