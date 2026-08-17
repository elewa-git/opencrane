import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import type { ConversationOnboardingContinuationPresentation } from "../../conversation-workspace-feature.types";

/**
 * Presents the terminal onboarding-history boundary and its one permitted continuation action.
 *
 * The feature mapper decides whether a new chat is available. This component only renders that
 * decision and emits an intent; it never infers Agent readiness or navigates on its own.
 *
 * Called by: `ConversationOnboardingHistoryComponent`, beneath the immutable transcript.
 * @see ConversationOnboardingContinuationPresentation for the directory-derived states it renders.
 */
@Component({ selector: "wo-conversation-onboarding-continuation", standalone: true, imports: [ButtonModule], templateUrl: "./conversation-onboarding-continuation.component.html", styleUrl: "./conversation-onboarding-continuation.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationOnboardingContinuationComponent
{
	/** Read-only explanation and action availability derived from the current directory projection. */
	public readonly continuation = input.required<ConversationOnboardingContinuationPresentation>();
	/** Requests the normal new-conversation mode picker when the projected action is available. */
	public readonly newChatRequested = output<void>();
}
