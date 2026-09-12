import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ConversationMessageComponent, ConversationRichTextComponent, ConversationStatusLineComponent } from "@opencrane/elements/conversation";
import { ConversationAssetCardComponent, type ConversationAssetActionIntent } from "@opencrane/features/conversation-assets";
import { ConversationWorkspaceTranscriptEntryKinds, type ConversationWorkspaceTranscriptEntry } from "../../presentation/conversation-workspace-presentation.types";
import { ConversationGroupMessageActionsComponent } from "../conversation-group-message-actions/conversation-group-message-actions.component";

/** Presents accessible message anchors and per-message group actions inside the page-owned scroll area. */
@Component({ selector: "wo-conversation-workspace-transcript", standalone: true, imports: [ConversationAssetCardComponent, ConversationMessageComponent, ConversationRichTextComponent, ConversationStatusLineComponent, ConversationGroupMessageActionsComponent], templateUrl: "./conversation-workspace-transcript.component.html", styleUrl: "./conversation-workspace-transcript.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceTranscriptComponent
{
	/** Ordered messages, canonical tool facts and admitted group actions for this selection. */
	public readonly entries = input<readonly ConversationWorkspaceTranscriptEntry[]>([]);
	/** Finite row anatomy used by the template switch. */
	protected readonly kinds = ConversationWorkspaceTranscriptEntryKinds;
	/** Requests assistant selection for an eligible message. */
	public readonly askRequested = output<string>();
	/** Requests human review of an eligible response. */
	public readonly shareRequested = output<string>();
	/** Requests navigation to a ready child conversation. */
	public readonly childRequested = output<string>();
	/** Forwards a bound file action to the workspace's existing content coordinator. */
	public readonly assetActionRequested = output<ConversationAssetActionIntent>();
}
