import { ChangeDetectionStrategy, Component } from "@angular/core";
import { type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";

import { AvatarTones } from "@opencrane/elements/ui";

import { ConversationComposerComponent } from "../conversation-composer/conversation-composer.component";
import { ConversationMessageComponent } from "../conversation-message/conversation-message.component";
import { ConversationRichTextComponent } from "../conversation-rich-text/conversation-rich-text.component";
import { ConversationRunActionsComponent } from "../conversation-run-actions/conversation-run-actions.component";
import { ConversationStatusLineComponent } from "../conversation-status-line/conversation-status-line.component";
import { ConversationComposerStates, ConversationMessageTones, ConversationStatusTones } from "../conversation.types";

/** Records emitted draft intent from the Storybook-only composer host. */
const _DRAFT_CHANGED = fn();

/** Records the explicit failed-run retry intent emitted by the shared action row. */
const _RETRY_REQUESTED = fn();

/** Storybook host that proves the controlled composer output binding in a real Angular template. */
@Component({ selector: "wo-desktop-conversation-story", standalone: true, imports: [ConversationComposerComponent], template: `<div style="max-width:720px;padding:20px"><wo-conversation-composer [draft]="draft" [state]="state" placeholder="Message this conversation…" (draftChange)="recordDraft($event)" /></div>`, changeDetection: ChangeDetectionStrategy.OnPush })
class _DesktopConversationStoryComponent
{
	/** Empty host-owned draft keeps the controlled send action disabled. */
	protected readonly draft = "";
	/** Available lifecycle keeps the textarea interactive. */
	protected readonly state = ConversationComposerStates.Available;

	/** Record one composer edit without adopting it as host state. */
	protected recordDraft(value: string): void { _DRAFT_CHANGED(value); }
}

/** Storybook metadata for controlled reusable conversation primitives. */
const meta: Meta<ConversationComposerComponent> =
{
	title: "Conversations/Shared elements",
	component: ConversationComposerComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [_DesktopConversationStoryComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationRunActionsComponent, ConversationStatusLineComponent] })],
	parameters: { docs: { description: { component: "Presentation-only message and controlled composer primitives shared by direct, group, and Agent-session conversations." } } }
};

export default meta;
type Story = StoryObj<ConversationComposerComponent>;

/** Desktop controlled composer emits user intent without keeping command state. */
export const DesktopConversation: Story =
{
	tags: ["visual-test"],
	render: function render() { return { template: `<wo-desktop-conversation-story />` }; },
	play: async function play({ canvasElement })
	{
		_DRAFT_CHANGED.mockClear();
		const canvas = within(canvasElement);
		const field = canvas.getByRole("textbox", { name: "Message" });
		await userEvent.type(field, "Follow up");
		await expect(_DRAFT_CHANGED).toHaveBeenCalled();
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
		return {
			props: {
				messages: [
					{
						id: "participant",
						authorName: "Alex",
						authorInitials: "AK",
						avatarTone: AvatarTones.Blue,
						timestampLabel: "11:07",
						body: "Participant message",
						tone: ConversationMessageTones.Participant
					},
					{
						id: "agent",
						authorName: "The Commander (Guardian)",
						authorInitials: "TC",
						avatarTone: AvatarTones.Brand,
						timestampLabel: "11:08",
						body: "Agent message",
						tone: ConversationMessageTones.Agent
					},
					{
						id: "system",
						authorName: "OpenCrane",
						authorInitials: "OC",
						avatarTone: AvatarTones.Neutral,
						timestampLabel: "11:09",
						body: "System notice",
						tone: ConversationMessageTones.System
					}
				],
				statuses: Object.values(ConversationStatusTones).map(tone => ({
					label: tone,
					detail: `Shared ${tone} state`,
					tone
				}))
			},
			template: `<div style="display:grid;gap:16px;max-width:720px;padding:20px">@for (message of messages; track message.id) { <wo-conversation-message [message]="message" /> } @for (status of statuses; track status.tone) { <wo-conversation-status-line [status]="status" /> }</div>`
		};
	}
};

/** Sanitized rich content and failed-run actions stay presentation-only. */
export const RichMessageAndFailedRun: Story =
{
	tags: ["visual-test"],
	render: function render()
	{
		return { props: { rich: { messageId: "message-rich", html: "<h3>Comparison</h3><p>The proposed term is <strong>lower risk</strong>.</p>", label: "Agent comparison" }, run: { statusLabel: "Run failed", canCancel: false, canRetry: true, canSteer: false, busy: false }, retryRequested: _RETRY_REQUESTED }, template: `<div style="display:grid;gap:16px;max-width:720px;padding:20px"><wo-conversation-rich-text [presentation]="rich" /><wo-conversation-run-actions [presentation]="run" (retryRequested)="retryRequested()" /></div>` };
	},
	play: async function play({ canvasElement })
	{
		_RETRY_REQUESTED.mockClear();
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Retry run" })).toBeEnabled();
		await userEvent.click(canvas.getByRole("button", { name: "Retry run" }));
		await expect(_RETRY_REQUESTED).toHaveBeenCalledTimes(1);
	}
};
