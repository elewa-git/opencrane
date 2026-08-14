import { moduleMetadata } from "@storybook/angular";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ConversationAssetDisposition, ConversationAssetProvenance, ConversationAssetSelectionFailures } from "@opencrane/state/conversation/assets";

import { ConversationAttachmentTrayComponent } from "../attachment-tray/conversation-attachment-tray.component";
import { ConversationAssetCardComponent } from "../asset-card/conversation-asset-card.component";
import { ConversationFilesPanelComponent } from "../files-panel/conversation-files-panel.component";
import { __ConversationAssetSelectionFeedback } from "../conversation-asset-presentation";
import { ConversationAssetPresentationStates, type ConversationAssetPresentation } from "../conversation-asset-presentation.types";

/** Build one deterministic browser-safe visual fixture. */
function _Item(id: string, displayName: string, state: ConversationAssetPresentationStates, overrides: Partial<ConversationAssetPresentation> = {}): ConversationAssetPresentation
{
	return { id, messageId: "message-1", provenance: ConversationAssetProvenance.ParticipantUpload, displayName, mediaType: "application/pdf", byteLength: 1_258_291, disposition: ConversationAssetDisposition.Preview, state, detail: _Detail(state), canRetry: state === ConversationAssetPresentationStates.Failed, canRemove: state === ConversationAssetPresentationStates.Selected, uploadProgressPercent: null, ...overrides };
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
	parameters: { docs: { description: { component: "Display-only conversation file primitives. Parents own navigation and commands; removal and retry controls appear only when the server or local pre-admission state grants them." } } },
	decorators: [moduleMetadata({ imports: [ConversationAttachmentTrayComponent, ConversationAssetCardComponent] })]
};

export default meta;
type Story = StoryObj<ConversationFilesPanelComponent>;

/** Composer chips cover selected, ready, processing, and visible failure actions. */
export const AttachmentTray: Story = {
	tags: ["visual-test"],
	parameters: { docs: { description: { story: "Covers selected, preparing, indeterminate upload progress, scanning, ready, and failed attachments plus the two composer actions." } } },
	render: function render() { return { props: { items: [_Item("local-1", "notes.pdf", ConversationAssetPresentationStates.Selected), _Item("local-2", "budget.xlsx", ConversationAssetPresentationStates.Creating), _Item("asset-2", "photos.zip", ConversationAssetPresentationStates.Uploading, { mediaType: "application/zip", disposition: ConversationAssetDisposition.Download }), _Item("asset-3", "interviews.mp3", ConversationAssetPresentationStates.Processing, { mediaType: "audio/mpeg" }), _Item("asset-ready", "brief.pdf", ConversationAssetPresentationStates.Ready), _Item("asset-4", "deck.key", ConversationAssetPresentationStates.Failed, { mediaType: "application/pdf" })], actionCount: 0 }, template: `<div style="max-width:760px;padding:20px;background:var(--oc-surface-paper)"><wo-conversation-attachment-tray [items]="items" (actionRequested)="actionCount = actionCount + 1" /><output data-testid="action-count" [attr.data-count]="actionCount"></output></div>` }; },
	play: async function play({ canvasElement }) { const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Retry" })); await userEvent.click(canvas.getByRole("button", { name: "Remove notes.pdf" })); await expect(canvas.getByTestId("action-count")).toHaveAttribute("data-count", "2"); }
};

/** Transcript cards keep participant and finalized assistant provenance visibly distinct. */
export const TranscriptCards: Story = {
	tags: ["visual-test"],
	parameters: { docs: { description: { story: "Participant attachments and finalized assistant outputs expose preview/download intents without owning navigation." } } },
	render: function render() { return { props: { ready: _READY, agent: _AGENT, actionCount: 0 }, template: `<div style="display:grid;gap:12px;max-width:620px;padding:20px;background:var(--oc-surface-paper)"><wo-conversation-asset-card [item]="ready" (actionRequested)="actionCount = actionCount + 1" /><wo-conversation-asset-card [item]="agent" (actionRequested)="actionCount = actionCount + 1" /><output data-testid="action-count" [attr.data-count]="actionCount"></output></div>` }; },
	play: async function play({ canvasElement }) { const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Preview" })); await userEvent.click(canvas.getAllByRole("button", { name: "Download" })[0] as HTMLElement); await expect(canvas.getByTestId("action-count")).toHaveAttribute("data-count", "2"); }
};

/** Files panel groups provenance and preserves canonical message-link actions. */
export const FilesPanel: Story = {
	tags: ["visual-test"],
	parameters: { docs: { description: { story: "The Files index groups participant and assistant provenance and emits open/focus-message intents for the workspace." } } },
	args: { items: [_READY, _Item("asset-zip", "photos.zip", ConversationAssetPresentationStates.Uploading, { mediaType: "application/zip", disposition: ConversationAssetDisposition.Download }), _AGENT, _Item("asset-chart", "timeline-chart.png", ConversationAssetPresentationStates.Failed, { provenance: ConversationAssetProvenance.AgentOutput, mediaType: "image/png" })] },
	render: function render(args) { return { props: { ...args, actionCount: 0 }, template: `<div style="width:360px;padding:12px;background:var(--oc-surface-paper)"><wo-conversation-files-panel [items]="items" (actionRequested)="actionCount = actionCount + 1" /><output data-testid="action-count" [attr.data-count]="actionCount"></output></div>` }; },
	play: async function play({ canvasElement }) { const canvas = within(canvasElement); await userEvent.click(canvas.getAllByRole("button", { name: "Open" })[0] as HTMLElement); await userEvent.click(canvas.getAllByRole("button", { name: "Show brief-v2.pdf in conversation" })[0] as HTMLElement); await expect(canvas.getByTestId("action-count")).toHaveAttribute("data-count", "2"); }
};

/** Non-disclosing edge states share labels but never expose scanner or storage coordinates. */
export const EdgeStatesCompact: Story = {
	tags: ["visual-test"],
	parameters: { docs: { description: { story: "Non-disclosing inaccessible, expired, removed, unavailable, and scan-pending states never expose storage or scanner coordinates." } } },
	args: { items: [_Item("scan", "supplier-counterproposal.pdf", ConversationAssetPresentationStates.Processing), _Item("access", "File unavailable", ConversationAssetPresentationStates.Inaccessible), _Item("expired", "temporary-tool-output.csv", ConversationAssetPresentationStates.Expired), _Item("removed", "Attachment removed", ConversationAssetPresentationStates.Removed), _Item("foreign", "File unavailable", ConversationAssetPresentationStates.Unavailable)] },
	render: function render(args) { return { props: args, template: `<div style="width:320px;padding:8px;background:var(--oc-surface-paper)"><wo-conversation-files-panel [items]="items" /></div>` }; }
};

/** Empty and rejected selection states remain visible even when no attachment was admitted. */
export const EmptyAndSelectionFailures: Story = {
	tags: ["visual-test"],
	parameters: { docs: { description: { story: "The empty Files index and all message-level selection rejections use stable plain language and admit no partial batch." } } },
	render: function render()
	{
		return {
			props: {
				tooMany: __ConversationAssetSelectionFeedback(ConversationAssetSelectionFailures.TooManyFiles),
				tooLarge: __ConversationAssetSelectionFeedback(ConversationAssetSelectionFailures.TotalTooLarge),
				unsupported: __ConversationAssetSelectionFeedback(ConversationAssetSelectionFailures.UnsupportedMediaType)
			},
			template: `<div style="display:grid;grid-template-columns:minmax(280px,1fr) 360px;gap:16px;max-width:820px;padding:16px;background:var(--oc-surface-paper)"><div style="display:grid;align-content:start;gap:10px"><wo-conversation-attachment-tray label="Too many files feedback" [feedback]="tooMany" /><wo-conversation-attachment-tray label="Total file size feedback" [feedback]="tooLarge" /><wo-conversation-attachment-tray label="Unsupported file type feedback" [feedback]="unsupported" /></div><wo-conversation-files-panel /></div>`
		};
	}
};
