import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import type { ConversationSummaryPresentation, ConversationWorkspaceAvailabilityPresentation } from "../../conversation-workspace-feature.types";

/** Owns selected-conversation heading, actions and context-trigger keyboard focus. */
@Component({ selector: "wo-conversation-workspace-header", standalone: true, imports: [ButtonModule], templateUrl: "./conversation-workspace-header.component.html", styleUrl: "./conversation-workspace-header.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationWorkspaceHeaderComponent
{
	/** Privacy-safe selected title and participant description. */
	public readonly summary = input<ConversationSummaryPresentation | null>(null);
	/** Existing workspace setup notice. */
	public readonly availabilityNotice = input<ConversationWorkspaceAvailabilityPresentation | null>(null);
	/** Whether the selected child offers navigation to its parent group. */
	public readonly hasParent = input(false);
	/** Whether a conversation command is pending. */
	public readonly busy = input(false);
	/** Whether the selected conversation is already closed. */
	public readonly closed = input(false);
	/** Whether the context panel is expanded. */
	public readonly contextPanelOpen = input(false);
	/** Capability-aware label for the context trigger. */
	public readonly contextPanelLabel = input("Files");
	/** Requests the selected child's parent group. */
	public readonly backRequested = output<void>();
	/** Requests archival through the authoritative store. */
	public readonly archiveRequested = output<void>();
	/** Requests closing through the authoritative store. */
	public readonly closeRequested = output<void>();
	/** Requests showing the page's context panel. */
	public readonly contextRequested = output<void>();
	/** Persistent trigger that receives focus when the page closes its context panel. */
	@ViewChild("contextPanelToggle")
	private _contextPanelToggle: ElementRef<HTMLButtonElement> | undefined;
	/** Restores keyboard focus without changing conversation selection. */
	public restoreContextFocus(): void
	{
		const trigger = this._contextPanelToggle;
		if (trigger !== undefined)
			globalThis.queueMicrotask(function _FocusTrigger() { trigger.nativeElement.focus(); });
	}
}
