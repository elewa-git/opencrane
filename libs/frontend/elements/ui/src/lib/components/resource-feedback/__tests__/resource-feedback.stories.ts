import type { Meta, StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";
import { ResourceFeedbackComponent } from "../resource-feedback.component";

/** Shared asynchronous feedback, including refresh failures with retained page content. */
const meta: Meta<ResourceFeedbackComponent> =
{
	title: "Foundation/Resource feedback",
	component: ResourceFeedbackComponent,
	tags: ["autodocs"],
	argTypes: { retryRequested: { action: "retryRequested" } },
	args: { retryRequested: fn() }
};
export default meta;
type Story = StoryObj<ResourceFeedbackComponent>;
/** Successful idle state adds no extra announcement. */
export const Idle: Story = {};
/** Initial and refresh reads use the owner's context-specific progress copy. */
export const Loading: Story = { args: { loading: true, loadingLabel: "Refreshing tools…" } };
/** Read failures can retry without dispatching a mutation. */
export const RetryableFailure: Story = { tags: ["visual-test"], args: { error: "Tools could not be refreshed. Previously loaded tools are still visible.", retryAvailable: true }, play: async function _Retry({ canvasElement, args }) { await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" })); await expect(args.retryRequested).toHaveBeenCalledOnce(); } };
/** A retry in progress cannot be admitted again through the control. */
export const Retrying: Story = { tags: ["visual-test"], args: { loading: true, error: "Tools could not be refreshed.", retryAvailable: true } };
/** Command failures can explain recovery without offering a read retry. */
export const CommandFailure: Story = { args: { error: "The provider key change could not be saved. Your draft is still available." } };
