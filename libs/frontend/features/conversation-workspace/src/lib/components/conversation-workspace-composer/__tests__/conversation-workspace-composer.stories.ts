import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";
import { ConversationComposerStates, ConversationStatusTones } from "@opencrane/elements/conversation";
import { ConversationWorkspaceComposerComponent } from "../conversation-workspace-composer.component";

/** Input and recovery composition retains server-owned command state as inputs. */
const meta: Meta<ConversationWorkspaceComposerComponent> = { title: "Conversations/Workspace composer", component: ConversationWorkspaceComposerComponent, tags: ["autodocs"], args: { composerState: ConversationComposerStates.Available, draft: "Please review the branch stock report." } };
export default meta;
type Story = StoryObj<ConversationWorkspaceComposerComponent>;
/** An open conversation accepts a controlled draft. */
export const Available: Story = { tags: ["visual-test"] };
/** Pending sends prevent repeat submission. */
export const Sending: Story = { args: { composerState: ConversationComposerStates.Submitting } };
/** Disconnected conversations retain the draft beside recovery controls. */
export const Reconnecting: Story = { tags: ["visual-test"], args: { composerState: ConversationComposerStates.Disabled, connectionStatus: { status: { label: "Connection lost", detail: "Your draft is still here.", tone: ConversationStatusTones.Danger }, reconnectAvailable: true } } };
/** A group failure offers a separate request-state refresh. */
export const GroupFailure: Story = { tags: ["visual-test"], args: { groupError: "Assistant request could not be refreshed.", groupRefreshAvailable: true } };
/** Recovery controls and the retained draft remain visible at the supported narrow viewport. */
export const ReconnectingNarrow: Story = { ...Reconnecting, tags: ["visual-test", "visual-test-narrow"], play: async function _NarrowBounds({ canvasElement })
{
	const canvas = within(canvasElement);
	const pickerBounds = canvas.getByLabelText("Attach PDF").getBoundingClientRect();
	const sendBounds = canvas.getByRole("button", { name: "Send" }).getBoundingClientRect();
	expect(Math.ceil(pickerBounds.right)).toBeLessThanOrEqual(globalThis.innerWidth);
	expect(Math.ceil(sendBounds.right)).toBeLessThanOrEqual(globalThis.innerWidth);
	expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth);
} };
