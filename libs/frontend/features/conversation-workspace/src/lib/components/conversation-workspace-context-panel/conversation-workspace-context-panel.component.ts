import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationActivityComponent } from "@opencrane/features/conversation-activity";
import { ConversationFilesPanelComponent, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import type { ConversationActivityRow, ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";

/**
 * Presents the selected session's collapsible Activity and Files context.
 *
 * The routed page owns visibility and focus restoration. This component only renders already mapped
 * rows, hides Agent Activity when the immutable mode disallows it, and forwards typed intents.
 *
 * Called by: `ConversationWorkspacePageComponent` beside an ordinary selected conversation.
 */
@Component({ selector: "wo-conversation-workspace-context-panel", standalone: true, imports: [ButtonModule, ConversationActivityComponent, ConversationFilesPanelComponent], templateUrl: "./conversation-workspace-context-panel.component.html", styleUrl: "./conversation-workspace-context-panel.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceContextPanelComponent
{
	/** Whether the selected immutable mode admits Agent-run Activity. */
	public readonly activityVisible = input(false);
	/** Ordered browser-safe Activity rows. */
	public readonly activityRows = input.required<readonly ConversationActivityRow[]>();
	/** Existing durable and browser-private file presentations. */
	public readonly assets = input.required<readonly ConversationAssetPresentation[]>();
	/** Requests page-owned panel closure. */
	public readonly closed = output<void>();
	/** Forwards one canonical Activity target to the page. */
	public readonly activityTargetRequested = output<ConversationActivityTarget>();
	/** Forwards one typed file action to the owning asset state. */
	public readonly assetActionRequested = output<ConversationAssetActionIntent>();
}
