import type { Meta, StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";

import { AvatarTones } from "@opencrane/elements/ui";

import { ConversationComposerComponent } from "../conversation-composer.component.js";
import { ConversationMessageComponent } from "../conversation-message.component.js";
import { ConversationStatusLineComponent } from "../conversation-status-line.component.js";
import { ConversationComposerStates, ConversationMessageTones, ConversationStatusTones } from "../conversation.types.js";

/** Storybook metadata for controlled reusable conversation primitives. */
const meta: Meta<ConversationComposerComponent> =
{
	title: "Conversations/Shared elements",
	component: ConversationComposerComponent,
	tags: ["autodocs"],
	parameters: { docs: { description: { component: "Presentation-only message and controlled composer primitives shared by direct, group, and Agent-session conversations." } } }
};

export default meta;
type Story = StoryObj<ConversationComposerComponent>;

/** Desktop transcript and controlled composer emit user intent without keeping command state. */
export const DesktopConversation: Story =
{
	tags: ["visual-test"],
	args: { draft: "", state: ConversationComposerStates.Available, placeholder: "Message this conversation…", draftChange: fn(), submitted: fn() },
	render: function render(args)
	{
		return { props: { ...args, message: { id: "message-1", authorName: "Alex Kimani", authorInitials: "AK", avatarTone: AvatarTones.Blue, timestampLabel: "11:07", body: "Can you compare the counterproposal?", tone: ConversationMessageTones.Participant } }, template: `<div style="display:grid;gap:16px;max-width:720px;padding:20px"><wo-conversation-message [message]="message" /><wo-conversation-composer [draft]="draft" [state]="state" [placeholder]="placeholder" (draftChange)="draftChange($event)" (submitted)="submitted($event)" /></div>` };
	},
	play: async function play({ args, canvasElement })
	{
		const canvas = within(canvasElement);
		const field = canvas.getByRole("textbox", { name: "Message" });
		await userEvent.type(field, "Follow up");
		await expect(args.draftChange).toHaveBeenCalled();
		await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
	}
};

/** Compact disabled composer keeps the controlled draft visible and keyboard focus clear. */
export const CompactDisabledComposer: Story =
{
	tags: ["visual-test", "visual-test-narrow"],
	parameters: { viewport: { defaultViewport: "mobile1" } },
	args: { draft: "This draft stays visible while reconnecting.", state: ConversationComposerStates.Disabled, placeholder: "Waiting…" },
	render: function render(args) { return { props: args, template: `<div style="width:390px;min-height:844px;padding:12px"><wo-conversation-composer [draft]="draft" [state]="state" [placeholder]="placeholder" /></div>` }; },
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("textbox", { name: "Message" })).toBeDisabled();
		await expect(canvas.getByDisplayValue("This draft stays visible while reconnecting.")).toBeVisible();
	}
};

/** Shared submitting state keeps the displayed draft while suppressing another send. */
export const SubmittingComposer: Story =
{
	tags: ["visual-test"],
	args: { draft: "Submitting this follow-up…", state: ConversationComposerStates.Submitting },
	render: function render(args) { return { props: args, template: `<div style="max-width:720px;padding:20px"><wo-conversation-composer [draft]="draft" [state]="state" /></div>` }; }
};

/** Message authorship and status urgency states remain finite shared visual contracts. */
export const MessageAndStatusStates: Story =
{
	tags: ["visual-test"],
	render: function render()
	{
		return { props: { messages: [{ id: "participant", authorName: "Alex", authorInitials: "AK", avatarTone: AvatarTones.Blue, timestampLabel: "11:07", body: "Participant message", tone: ConversationMessageTones.Participant }, { id: "agent", authorName: "Nova", authorInitials: "N", avatarTone: AvatarTones.Brand, timestampLabel: "11:08", body: "Agent message", tone: ConversationMessageTones.Agent }, { id: "system", authorName: "OpenCrane", authorInitials: "OC", avatarTone: AvatarTones.Neutral, timestampLabel: "11:09", body: "System notice", tone: ConversationMessageTones.System }], statuses: Object.values(ConversationStatusTones).map(function _Status(tone) { return { label: tone, detail: `Shared ${tone} state`, tone }; }) }, template: `<div style="display:grid;gap:16px;max-width:720px;padding:20px">@for (message of messages; track message.id) { <wo-conversation-message [message]="message" /> } @for (status of statuses; track status.tone) { <wo-conversation-status-line [status]="status" /> }</div>` };
	}
};
