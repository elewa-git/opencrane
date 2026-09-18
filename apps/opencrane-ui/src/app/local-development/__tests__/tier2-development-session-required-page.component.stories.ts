import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { Tier2DevelopmentSessionRequiredPageComponent } from "../tier2-development-session-required-page.component";
import { Tier2DevelopmentSessionGuidanceStates } from "../tier2-development-session.types";

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
				component: "The Tier 2-only entry page for a tab that has not joined its launcher or whose private session belongs to an earlier launch. It presents the supplied guidance state and a same-origin handoff without detecting, authorizing, or displaying a credential."
			}
		}
	}
};

export default meta;

/** Local story type for the finite Tier 2 browser-session guidance states. */
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
	parameters: { docs: { description: { story: "A desktop tab that has not joined the current launcher. The page presents the supplied missing-session state and same-origin handoff but does not detect or authorize a browser session." } } },
	play: _AssertCurrentLaunchAction
};

/** Narrow state proving that the current-launch action fits a supported mobile viewport. */
export const MissingBrowserSessionNarrow: Story =
{
	tags: ["visual-test", "visual-test-full-viewport", "visual-test-narrow"],
	parameters: { docs: { description: { story: "The missing-session handoff at the supported narrow viewport. It proves the user-activated action remains reachable while session detection and authorization stay with the launcher boundary." } } },
	play: _AssertCurrentLaunchAction
};

/** Assert that an obsolete tab recovers through an explicit same-origin new-tab handoff. */
async function _AssertReplacedLaunchAction({ canvasElement }: { canvasElement: HTMLElement }): Promise<void>
{
	const canvas = within(canvasElement);
	const action = canvas.getByRole("link", { name: "Open current Tier 2 session in a new tab" });

	await expect(action).toHaveAttribute("href", "/api/v1/auth/development-session");
	await expect(action).toHaveAttribute("target", "_blank");
	await expect(action).toHaveAttribute("rel", expect.stringContaining("noopener"));
	await expect(action.getAttribute("rel")).not.toContain("noreferrer");
	await expect(canvasElement).not.toHaveTextContent("development-session=");
}

/** Desktop warning shown when a restart replaces the private session held by this tab. */
export const ReplacedBrowserSession: Story =
{
	args: { guidanceState: Tier2DevelopmentSessionGuidanceStates.Replaced },
	tags: ["visual-test", "visual-test-full-viewport"],
	parameters: { docs: { description: { story: "A desktop obsolete-tab state already classified by the server and Tier 2 transport. The page offers a same-origin new-tab handoff but neither detects nor authorizes the replacement session itself." } } },
	play: _AssertReplacedLaunchAction
};

/** Narrow warning proving that the explicit new-tab action remains usable on mobile. */
export const ReplacedBrowserSessionNarrow: Story =
{
	args: { guidanceState: Tier2DevelopmentSessionGuidanceStates.Replaced },
	tags: ["visual-test", "visual-test-full-viewport", "visual-test-narrow"],
	parameters: { docs: { description: { story: "The server-classified obsolete-tab warning at the supported narrow viewport. It preserves the same-origin new-tab handoff while detection and session authority remain outside the component." } } },
	play: _AssertReplacedLaunchAction
};
