import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ConversationAssetDisposition, ConversationAssetProvenance } from "@opencrane/state/conversation/assets";

import { ConversationAttachmentTrayComponent } from "../attachment-tray/conversation-attachment-tray.component.js";
import { ConversationAssetCardComponent } from "../asset-card/conversation-asset-card.component.js";
import { ConversationFilesPanelComponent } from "../files-panel/conversation-files-panel.component.js";
import { ConversationAssetPresentationStates, type ConversationAssetPresentation } from "../conversation-asset-presentation.types.js";

/** Build one deterministic browser-safe visual fixture. */
function _Item(id: string, displayName: string, state: ConversationAssetPresentationStates, overrides: Partial<ConversationAssetPresentation> = {}): ConversationAssetPresentation
{
	return { id, messageId: "message-1", provenance: ConversationAssetProvenance.ParticipantUpload, displayName, mediaType: "application/pdf", byteLength: 1_258_291, disposition: ConversationAssetDisposition.Preview, state, detail: _Detail(state), canRetry: state === ConversationAssetPresentationStates.Failed, canRemove: state === ConversationAssetPresentationStates.Selected, ...overrides };
}

/** Plain-language fixture state labels. */
function _Detail(state: ConversationAssetPresentationStates): string
{
	const labels: Record<ConversationAssetPresentationStates, string> = {
		[ConversationAssetPresentationStates.Selected]: "Ready to upload",
		[ConversationAssetPresentationStates.Creating]: "Preparing file",
		[ConversationAssetPresentationStates.Uploading]: "Uploading",
		[ConversationAssetPresentationStates.Processing]: "Checking file",
		[ConversationAssetPresentationStates.Ready]: "Ready",
		[ConversationAssetPresentationStates.Failed]: "File failed",
		[ConversationAssetPresentationStates.Inaccessible]: "Access changed",
		[ConversationAssetPresentationStates.Expired]: "Expired",
		[ConversationAssetPresentationStates.Removed]: "Removed",
		[ConversationAssetPresentationStates.Unavailable]: "File unavailable"
	};
	return labels[state];
}

const _READY = _Item("asset-ready", "brief-v2.pdf", ConversationAssetPresentationStates.Ready);
const _AGENT = _Item("asset-agent", "Pitch outline — Nova.docx", ConversationAssetPresentationStates.Ready, { provenance: ConversationAssetProvenance.AgentOutput, mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", disposition: ConversationAssetDisposition.Download, byteLength: 84_201 });

const meta: Meta<ConversationFilesPanelComponent> = {
	title: "Conversations/Assets",
	component: ConversationFilesPanelComponent,
	tags: ["autodocs"],
	decorators: [moduleMetadata({ imports: [ConversationAttachmentTrayComponent, ConversationAssetCardComponent] })]
};

export default meta;
type Story = StoryObj<ConversationFilesPanelComponent>;

/** Composer chips cover selected, ready, processing, and visible failure actions. */
export const AttachmentTray: Story = {
	tags: ["visual-test"],
	render: function render() { return { props: { items: [_Item("local-1", "notes.pdf", ConversationAssetPresentationStates.Selected), _Item("asset-2", "photos.zip", ConversationAssetPresentationStates.Uploading, { mediaType: "application/zip", disposition: ConversationAssetDisposition.Download }), _Item("asset-3", "interviews.mp3", ConversationAssetPresentationStates.Processing, { mediaType: "audio/mpeg" }), _Item("asset-4", "deck.key", ConversationAssetPresentationStates.Failed, { mediaType: "application/pdf" })], actionCount: 0 }, template: `<div style="max-width:720px;padding:20px;background:var(--oc-surface-paper)"><wo-conversation-attachment-tray [items]="items" (actionRequested)="actionCount = actionCount + 1" /><output data-testid="action-count" [attr.data-count]="actionCount"></output></div>` }; },
	play: async function play({ canvasElement }) { const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Retry" })); await userEvent.click(canvas.getByRole("button", { name: "Remove notes.pdf" })); await expect(canvas.getByTestId("action-count")).toHaveAttribute("data-count", "2"); }
};

/** Transcript cards keep participant and finalized assistant provenance visibly distinct. */
export const TranscriptCards: Story = {
	tags: ["visual-test"],
	render: function render() { return { props: { ready: _READY, agent: _AGENT }, template: `<div style="display:grid;gap:12px;max-width:620px;padding:20px;background:var(--oc-surface-paper)"><wo-conversation-asset-card [item]="ready" /><wo-conversation-asset-card [item]="agent" /></div>` }; }
};

/** Files panel groups provenance and preserves canonical message-link actions. */
export const FilesPanel: Story = {
	tags: ["visual-test"],
	args: { items: [_READY, _Item("asset-zip", "photos.zip", ConversationAssetPresentationStates.Uploading, { mediaType: "application/zip", disposition: ConversationAssetDisposition.Download }), _AGENT, _Item("asset-chart", "timeline-chart.png", ConversationAssetPresentationStates.Failed, { provenance: ConversationAssetProvenance.AgentOutput, mediaType: "image/png" })] },
	render: function render(args) { return { props: args, template: `<div style="width:360px;padding:12px;background:var(--oc-surface-paper)"><wo-conversation-files-panel [items]="items" /></div>` }; }
};

/** Non-disclosing edge states share labels but never expose scanner or storage coordinates. */
export const EdgeStatesCompact: Story = {
	tags: ["visual-test"],
	args: { items: [_Item("scan", "supplier-counterproposal.pdf", ConversationAssetPresentationStates.Processing), _Item("access", "File unavailable", ConversationAssetPresentationStates.Inaccessible), _Item("expired", "temporary-tool-output.csv", ConversationAssetPresentationStates.Expired), _Item("removed", "Attachment removed", ConversationAssetPresentationStates.Removed), _Item("foreign", "File unavailable", ConversationAssetPresentationStates.Unavailable)] },
	render: function render(args) { return { props: args, template: `<div style="width:320px;padding:8px;background:var(--oc-surface-paper)"><wo-conversation-files-panel [items]="items" /></div>` }; }
};
