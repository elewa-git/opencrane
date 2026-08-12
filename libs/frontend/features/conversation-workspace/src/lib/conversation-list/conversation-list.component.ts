import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationOnboardingHistoryStatuses } from "@opencrane/state/conversation/workspace";

import type { ConversationOnboardingHistoryPresentation, ConversationSummaryPresentation } from "../conversation-workspace-feature.types.js";

/** Feature-local conversation rail for selection and new-conversation intent. */
@Component({ selector: "wo-conversation-list", standalone: true, imports: [ButtonModule], templateUrl: "./conversation-list.component.html", styleUrl: "./conversation-list.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationListComponent
{
	/** Privacy-safe conversation rows. */
	public readonly items = input<readonly ConversationSummaryPresentation[]>([]);
	/** Optional completed onboarding exchange shown outside normal conversation modes. */
	public readonly onboardingHistory = input<ConversationOnboardingHistoryPresentation | null>(null);
	/** Honest history state when no transcript can be selected. */
	public readonly onboardingHistoryStatus = input(ConversationOnboardingHistoryStatuses.Unavailable);
	/** Whether the read-only onboarding exchange is selected. */
	public readonly onboardingSelected = input(false);
	/** Currently selected conversation coordinate. */
	public readonly selectedId = input<string | null>(null);
	/** Emits a request to show immutable-mode creation choices. */
	public readonly createRequested = output<void>();
	/** Emits one selected opaque conversation coordinate. */
	public readonly selected = output<string>();
	/** Emits selection of the separate onboarding history projection. */
	public readonly onboardingHistorySelected = output<void>();
	/** Stable history state vocabulary used by the template. */
	protected readonly historyStatuses = ConversationOnboardingHistoryStatuses;
}
