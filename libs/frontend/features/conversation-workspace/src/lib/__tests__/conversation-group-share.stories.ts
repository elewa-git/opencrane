import { type Meta, type StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ConversationGroupCommandStates } from "@opencrane/state/conversation/workspace";

import { ConversationGroupShareComponent } from "../components/conversation-group-share/conversation-group-share.component";

/** Shows reviewed human sharing; the fixture never posts a message or grants parent access. */
const meta: Meta<ConversationGroupShareComponent> = { title: "Conversations/Group result share", component: ConversationGroupShareComponent, tags: ["autodocs"], render: function _Render(args) { return { props: { ...args, shared: false, destination: "" }, template: `<div style="min-block-size: 100vh" [attr.data-reviewed-text]="text" [attr.data-shared]="shared" [attr.data-destination]="destination"><wo-conversation-group-share [visible]="visible" [text]="text" [state]="state" [error]="error" (textChanged)="text = $event" (submitted)="shared = true" (groupRequested)="destination = 'group'" (dismissed)="visible = false" /></div>` }; }, args: { visible: true, text: "Proposal A costs less. Proposal B gives us an earlier delivery date. I suggest we confirm the delivery dates before choosing.", state: ConversationGroupCommandStates.Idle }, parameters: { layout: "fullscreen", docs: { description: { component: "A completed assistant response becomes editable review text. The human must confirm the share, and the group receives the human's message. These fixtures verify review controls and feedback, not API identity or persistence." } } } };
export default meta;
type Story = StoryObj<ConversationGroupShareComponent>;

/** Requires review and an explicit human-share action while returning text edits to the store. */
export const Review: Story = { tags: ["visual-test"] };

/** Verifies editing and confirmation independently of the static review screenshot. */
export const EditAndShare: Story = { play: async function _Review({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	const field = await dialog.findByRole("textbox", { name: "Message to share" });
	await userEvent.type(field, " Agreed.");
	expect(canvasElement.querySelector("[data-reviewed-text]")?.getAttribute("data-reviewed-text")).toContain("Agreed.");
	await userEvent.click(dialog.getByRole("button", { name: "Share as my message" }));
	expect(canvasElement.querySelector("[data-shared]")).toHaveAttribute("data-shared", "true");
} };

/** Locks the text and avoids duplicate submissions while the share response is pending. */
export const Pending: Story = { args: { state: ConversationGroupCommandStates.Submitting }, play: async function _Pending({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	expect(await dialog.findByRole("textbox", { name: "Message to share" })).toBeDisabled();
	expect(dialog.getByRole("button", { name: "Share as my message" })).toBeDisabled();
} };

/** Retains the reviewed human text when the response is uncertain. */
export const Retry: Story = { args: { state: ConversationGroupCommandStates.Failed, error: "The share could not be confirmed. Your reviewed text is kept for retry." } };

/** Reports a confirmed human message and offers normal navigation to its group. */
export const Shared: Story = { args: { state: ConversationGroupCommandStates.Accepted }, play: async function _Shared({ canvasElement })
{
	const dialog = within(canvasElement.ownerDocument.body);
	await waitFor(function _Visible() { expect(dialog.getByText("Shared to the group as you.")).toBeVisible(); });
	expect(dialog.queryByRole("button", { name: "Share as my message" })).toBeNull();
	await userEvent.click(dialog.getByRole("button", { name: "Back to group" }));
	expect(canvasElement.querySelector("[data-destination]")).toHaveAttribute("data-destination", "group");
} };
