import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

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
				component: "The Tier 2-only entry page shown when this page session has not joined its current launcher. Its same-origin link performs one user-activated handoff without displaying the credential."
			}
		}
	}
};

export default meta;

/** Local story type for the fixed missing-session state. */
type Story = StoryObj<Tier2DevelopmentSessionRequiredPageComponent>;

/** Assert the current-launch action stays a same-tab, same-origin handoff. */
async function _AssertCurrentLaunchAction({ canvasElement }: { canvasElement: HTMLElement }): Promise<void>
{
	const canvas = within(canvasElement);
	const action = canvas.getByRole("link", { name: "Open current Tier 2 session" });

	await expect(action).toHaveAttribute("href", "/api/v1/auth/development-session");
	await expect(action).not.toHaveAttribute("target");
	await expect(canvasElement).not.toHaveTextContent("development-session=");
}

/** Desktop state for a page session ready to join its current launcher. */
export const MissingBrowserSession: Story =
{
	tags: ["visual-test", "visual-test-full-viewport"],
	play: _AssertCurrentLaunchAction
};

/** Narrow state proving that the current-launch action fits a supported mobile viewport. */
export const MissingBrowserSessionNarrow: Story =
{
	tags: ["visual-test", "visual-test-full-viewport", "visual-test-narrow"],
	play: _AssertCurrentLaunchAction
};
