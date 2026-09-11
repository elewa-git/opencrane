import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ConversationMessageComponent, ConversationRichTextComponent } from "@opencrane/elements/conversation";
import type { ConversationWorkspaceTranscriptEntry } from "../../presentation/conversation-workspace-presentation.types";
import { ConversationGroupMessageActionsComponent } from "../conversation-group-message-actions/conversation-group-message-actions.component";

/** Presents accessible message anchors and per-message group actions inside the page-owned scroll area. */
@Component({ selector: "wo-conversation-workspace-transcript", standalone: true, imports: [ConversationMessageComponent, ConversationRichTextComponent, ConversationGroupMessageActionsComponent], templateUrl: "./conversation-workspace-transcript.component.html", styleUrl: "./conversation-workspace-transcript.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceTranscriptComponent
{
	/** Sanitized messages and admitted group actions for this selection. */
	public readonly entries = input<readonly ConversationWorkspaceTranscriptEntry[]>([]);
	/** Requests assistant selection for an eligible message. */
	public readonly askRequested = output<string>();
	/** Requests human review of an eligible response. */
	public readonly shareRequested = output<string>();
	/** Requests navigation to a ready child conversation. */
	public readonly childRequested = output<string>();
}
