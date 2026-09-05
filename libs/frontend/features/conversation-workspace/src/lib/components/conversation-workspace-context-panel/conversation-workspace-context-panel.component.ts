import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationActivityComponent } from "@opencrane/features/conversation-activity";
import { ConversationFilesPanelComponent, type ConversationAssetActionIntent, type ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import type { ConversationActivityRow, ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";
import type { ConversationComputerBrowserTarget, ConversationComputerCommandResult } from "@opencrane/state/conversation/workspace";
import { ConversationComputerReviewComponent, type ConversationComputerLocalhostIntent } from "../conversation-computer-review/conversation-computer-review.component";
import { ConversationWorkspaceContextSections } from "./conversation-workspace-context-panel.types";

/**
 * Presents the selected session's collapsible Activity and Files context.
 *
 * The routed page owns visibility and focus restoration. This component only renders already mapped
 * rows, hides Agent Activity when the immutable mode disallows it, and forwards typed intents.
 *
 * Called by: `ConversationWorkspacePageComponent` beside an ordinary selected conversation.
 */
@Component({ selector: "wo-conversation-workspace-context-panel", standalone: true, imports: [ButtonModule, ConversationActivityComponent, ConversationComputerReviewComponent, ConversationFilesPanelComponent], templateUrl: "./conversation-workspace-context-panel.component.html", styleUrl: "./conversation-workspace-context-panel.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceContextPanelComponent
{
	/** Stable section vocabulary used by the accessible tab controls. */
	protected readonly sections = ConversationWorkspaceContextSections;
	/** Locally selected visual section; it carries no server authority. */
	protected readonly selectedSection = signal(ConversationWorkspaceContextSections.Files);
	/** Whether the selected immutable mode admits Agent-run Activity. */
	public readonly activityVisible = input(false);
	/** Ordered browser-safe Activity rows. */
	public readonly activityRows = input.required<readonly ConversationActivityRow[]>();
	/** Existing durable and browser-private file presentations. */
	public readonly assets = input.required<readonly ConversationAssetPresentation[]>();
	/** Whether the selected Agent session has an active review-capable computer. */
	public readonly computerReviewVisible = input(false);
	/** Review request state. */
	public readonly computerReviewBusy = input(false);
	/** Display-safe review failure. */
	public readonly computerReviewError = input<string | null>(null);
	/** Selected workspace file. */
	public readonly computerFile = input("");
	/** Selected workspace diff. */
	public readonly computerDiff = input<ConversationComputerCommandResult | null>(null);
	/** Last command result. */
	public readonly computerCommand = input<ConversationComputerCommandResult | null>(null);
	/** Private browser targets. */
	public readonly computerBrowserTargets = input<readonly ConversationComputerBrowserTarget[]>([]);
	/** Last screenshot URL. */
	public readonly computerScreenshotUrl = input<string | null>(null);
	/** Last inert localhost preview source. */
	public readonly computerPreview = input("");
	/** Requests page-owned panel closure. */
	public readonly closed = output<void>();
	/** Forwards one canonical Activity target to the page. */
	public readonly activityTargetRequested = output<ConversationActivityTarget>();
	/** Forwards one typed file action to the owning asset state. */
	public readonly assetActionRequested = output<ConversationAssetActionIntent>();
	/** Forwards file inspection intent. */
	public readonly computerInspectRequested = output<string>();
	/** Forwards argv command intent. */
	public readonly computerCommandRequested = output<readonly string[]>();
	/** Forwards browser refresh intent. */
	public readonly computerBrowserRefreshRequested = output<void>();
	/** Forwards page creation intent. */
	public readonly computerPageRequested = output<ConversationComputerLocalhostIntent>();
	/** Forwards screenshot intent. */
	public readonly computerScreenshotRequested = output<ConversationComputerLocalhostIntent>();
	/** Forwards preview intent. */
	public readonly computerPreviewRequested = output<ConversationComputerLocalhostIntent>();

	/** Fall back to Files whenever computer review is no longer available. */
	protected activeSection(): ConversationWorkspaceContextSections
	{
		return this.computerReviewVisible() ? this.selectedSection() : ConversationWorkspaceContextSections.Files;
	}
}
