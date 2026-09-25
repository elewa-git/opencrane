import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { AvatarCircleComponent, AvatarSizes, OpenCraneBrandAppearances, OpenCraneBrandComponent } from "@opencrane/elements/ui";

import { type ConversationRailIdentityPresentation, type ConversationSessionRailItemPresentation, type ConversationSessionRailSelectionIntent } from "../../conversation-workspace-feature.types";
import { _PendingQuestionLabel } from "../../conversation-pending-question.mapper";
import { ConversationSessionRailRowComponent } from "../conversation-session-rail-row/conversation-session-rail-row.component";

/**
 * Draws the workspace rail as one participant-facing session list.
 *
 * Completed onboarding remains a separate read-only server projection, but this component presents
 * it as the Welcome session beside ordinary conversations. It never turns the onboarding key into a
 * conversation route coordinate or gives it archive, run, or composer controls.
 *
 * Called by: `ConversationWorkspacePageComponent`.
 */
@Component({ selector: "wo-conversation-list", standalone: true, imports: [AvatarCircleComponent, ButtonModule, ConversationSessionRailRowComponent, OpenCraneBrandComponent], templateUrl: "./conversation-list.component.html", styleUrl: "./conversation-list.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationListComponent
{
	/** Completed onboarding and ordinary conversation rows in display order. */
	public readonly items = input<readonly ConversationSessionRailItemPresentation[]>([]);
	/** Browser key of the selected row, or `null` when no session is open. */
	public readonly selectedKey = input<string | null>(null);
	/** Generic directory-derived self label for the optional rail footer. */
	public readonly identity = input<ConversationRailIdentityPresentation | null>(null);
	/** Whether the current signed-in workspace can open its global Activity index. */
	public readonly activityAvailable = input(false);
	/** Current authority-backed questions that still need this participant's response. */
	public readonly pendingQuestionCount = input(0);
	/** Fires when the participant asks to open the existing mode-choice dialog. */
	public readonly createRequested = output<void>();
	/** Reports the selected server-backed source without navigating or reading state. */
	public readonly itemSelected = output<ConversationSessionRailSelectionIntent>();
	/** Requests the page-owned Activity panel without changing session selection. */
	public readonly activityRequested = output<void>();
	/** Optional PrimeNG badge value; zero keeps the persistent action visually quiet. */
	protected readonly activityBadge = computed(() => this.pendingQuestionCount() > 0 ? String(this.pendingQuestionCount()) : undefined);
	/** Accessible action copy includes the same authority-backed count as the badge. */
	protected readonly activityLabel = computed(() => this.pendingQuestionCount() > 0 ? `Activity, ${_PendingQuestionLabel(this.pendingQuestionCount())}` : "Activity");
	/** Polite count announcement remains separate from the actionable button name. */
	protected readonly activityNotice = computed(() => this.pendingQuestionCount() > 0 ? _PendingQuestionLabel(this.pendingQuestionCount()) : "No questions need your response.");
	/** Shared avatar size used by the self-label footer. */
	protected readonly identityAvatarSize = AvatarSizes.Medium;
	/** Full wordmark treatment used by persistent application navigation. */
	protected readonly brandAppearance = OpenCraneBrandAppearances.Navigation;
	/** Persistent Activity trigger that receives focus after its global panel closes. */
	@ViewChild("activityToggle", { read: ElementRef })
	private _activityToggle: ElementRef<HTMLElement> | undefined;

	/**
	 * Returns keyboard focus to the persistent Activity action after its panel closes.
	 *
	 * Called by: `ConversationWorkspacePageComponent.closeContextPanel` when the global Activity panel
	 * was opened from the session rail.
	 */
	public restoreActivityFocus(): void
	{
		const trigger = this._activityToggle;
		if (trigger !== undefined)
			globalThis.queueMicrotask(function _FocusTrigger() { trigger.nativeElement.querySelector<HTMLButtonElement>("button")?.focus(); });
	}

	/** Forward one row's typed source coordinates to the routed page. */
	protected select(item: ConversationSessionRailItemPresentation): void
	{
		this.itemSelected.emit({ kind: item.kind, conversationId: item.conversationId });
	}
}
