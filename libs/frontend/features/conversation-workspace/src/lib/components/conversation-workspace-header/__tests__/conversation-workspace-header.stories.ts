import type { Meta, StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";
import { ConversationSessionRailIconStates } from "../../../conversation-workspace-feature.types";
import { ConversationWorkspaceHeaderComponent } from "../conversation-workspace-header.component";

/** Selected conversation header states, independent from gateway orchestration. */
const meta: Meta<ConversationWorkspaceHeaderComponent> =
{
	title: "Conversations/Workspace header",
	component: ConversationWorkspaceHeaderComponent,
	tags: ["autodocs"],
	argTypes: { contextRequested: { action: "contextRequested" } },
	args:
	{
		summary: { id: "chat-1", title: "Branch planning", modeLabel: "Group chat", participantLabel: "Three participants", iconState: ConversationSessionRailIconStates.Group, archived: false },
		contextPanelLabel: "Files", contextRequested: fn()
	}
};
export default meta;
type Story = StoryObj<ConversationWorkspaceHeaderComponent>;
/** Context trigger reports its expanded state and emits an intent. */
export const Open: Story = { play: async function _Context({ canvasElement, args }) { const button = within(canvasElement).getByRole("button", { name: "Files" }); await expect(button).toHaveAttribute("aria-expanded", "false"); await userEvent.click(button); await expect(args.contextRequested).toHaveBeenCalledOnce(); } };
/** A child conversation offers navigation to its parent group. */
export const Child: Story = { tags: ["visual-test"], args: { hasParent: true } };
/** Closing an already closed conversation is unavailable. */
export const Closed: Story = { tags: ["visual-test"], args: { closed: true } };
/** Pending conversation commands keep the selected heading visible. */
export const Busy: Story = { args: { busy: true } };
/** A child header keeps parent navigation and conversation actions usable in a narrow column. */
export const ChildNarrow: Story = { ...Child, tags: ["visual-test", "visual-test-narrow"] };
