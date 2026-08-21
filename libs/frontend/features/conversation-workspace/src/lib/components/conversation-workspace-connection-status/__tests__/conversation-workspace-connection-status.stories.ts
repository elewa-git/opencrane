import { type Meta, type StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { ConversationStatusTones } from "@opencrane/elements/conversation";

import { ConversationWorkspaceConnectionStatusComponent } from "../conversation-workspace-connection-status.component";

/** Defines focused visual contracts for the in-chat connection recovery notice. */
const meta: Meta<ConversationWorkspaceConnectionStatusComponent> =
{
	title: "Conversations/Connection status",
	component: ConversationWorkspaceConnectionStatusComponent,
	tags: ["autodocs"]
};

export default meta;
type Story = StoryObj<ConversationWorkspaceConnectionStatusComponent>;

/** Narrow reconnect notice keeps its current attempt and recovery action visible. */
export const Reconnecting: Story =
{
	tags: ["visual-test", "visual-test-narrow"],
	args: { status: { label: "Reconnecting — attempt 2", detail: "Your draft is still here. Sending resumes when the connection returns.", tone: ConversationStatusTones.Attention }, reconnectAvailable: true },
	parameters: { viewport: { defaultViewport: "mobile1" } },
	play: async function _VerifyReconnectAction({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Reconnecting — attempt 2")).toBeVisible();
		expect(canvas.getByRole("button", { name: "Reconnect now" })).toBeEnabled();
	}
};

/** Narrow pending notice keeps the one active replacement visibly disabled. */
export const ManualReconnectPending: Story =
{
	tags: ["visual-test", "visual-test-narrow"],
	args: { status: { label: "Connecting to chat", detail: "Messages will be available when the connection is ready.", tone: ConversationStatusTones.Neutral }, reconnectAvailable: true, reconnectPending: true },
	parameters: { viewport: { defaultViewport: "mobile1" } },
	play: async function _VerifyPendingAction({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Connecting to chat")).toBeVisible();
		expect(canvas.getByRole("button", { name: "Reconnecting…" })).toBeDisabled();
	}
};
