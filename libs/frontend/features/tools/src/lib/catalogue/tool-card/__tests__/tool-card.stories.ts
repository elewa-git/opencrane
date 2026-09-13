import type { Meta, StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";
import { ToolCardComponent } from "../tool-card.component";
import { TOOL_STORY_SERVER } from "../../../state/__tests__/tools-story.fixtures";

/** States of a catalogue card, using production tool styles. */
const meta: Meta<ToolCardComponent> =
{
	title: "Tools/Catalogue card",
	component: ToolCardComponent,
	tags: ["autodocs"],
	argTypes: { installRequested: { action: "installRequested" } },
	args: { server: TOOL_STORY_SERVER, installRequested: fn() }
};
export default meta;
type Story = StoryObj<ToolCardComponent>;
/** Available card emits one installation intent. */
export const Available: Story = { tags: ["visual-test"], play: async function _Install({ canvasElement, args }) { await userEvent.click(within(canvasElement).getByRole("button", { name: "Install" })); await expect(args.installRequested).toHaveBeenCalledOnce(); } };
/** Pending install cannot be submitted again. */
export const Installing: Story = { args: { busy: true }, play: async function _Disabled({ canvasElement }) { await expect(within(canvasElement).getByRole("button", { name: "Install" })).toBeDisabled(); } };
/** Installed cards have no installation command. */
export const Installed: Story = { tags: ["visual-test"], args: { installed: true } };
/** Long text remains within a narrow card. */
export const LongContent: Story = { tags: ["visual-test", "visual-test-narrow"], args: { server: { ...TOOL_STORY_SERVER, name: "Branch stock and sales reporting for agricultural suppliers", description: TOOL_STORY_SERVER.description.repeat(4) } } };
