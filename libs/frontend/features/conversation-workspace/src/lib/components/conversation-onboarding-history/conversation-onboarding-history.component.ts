import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { MessageModule } from "primeng/message";

import { ConversationRichTextComponent } from "@opencrane/elements/conversation";
import { ScopeChipAppearances, ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";

import { ConversationOnboardingDialogueSpeakers, type ConversationOnboardingContinuationPresentation, type ConversationOnboardingDialogueEntryPresentation, type ConversationOnboardingHistoryPresentation, type ConversationWorkspaceAvailabilityPresentation } from "../../conversation-workspace-feature.types";
import { ConversationOnboardingContinuationComponent } from "../conversation-onboarding-continuation/conversation-onboarding-continuation.component";

/**
 * Shows the completed private onboarding dialogue inside the normal session workspace.
 *
 * The server projection remains distinct from an ordinary Conversation, so this component owns a
 * read-only header, guide/participant dialogue, completion marker, and continuation intent only.
 * It never renders a composer, run controls, archive controls, Activity, or Files.
 *
 * Called by: `ConversationWorkspacePageComponent` when the Welcome session is selected.
 */
@Component({ selector: "wo-conversation-onboarding-history", standalone: true, imports: [ConversationOnboardingContinuationComponent, ConversationRichTextComponent, MessageModule, ScopeChipComponent], templateUrl: "./conversation-onboarding-history.component.html", styleUrl: "./conversation-onboarding-history.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationOnboardingHistoryComponent
{
	/** Success tone used by the completed status chip. */
	public readonly chipTone = ScopeChipTones.Success;
	/** Soft chip appearance keeps completion visible without competing with the dialogue. */
	public readonly chipAppearance = ScopeChipAppearances.Soft;
	/** Stable dialogue speakers used by the template's alignment branch. */
	protected readonly speakers = ConversationOnboardingDialogueSpeakers;
	/** Heading and completion time already formatted by the feature mapper. */
	public readonly presentation = input.required<ConversationOnboardingHistoryPresentation>();
	/** Optional directory-derived warning shown above the saved dialogue. */
	public readonly availability = input<ConversationWorkspaceAvailabilityPresentation | null>(null);
	/** Read-only boundary and next-step availability derived by the feature presenter. */
	public readonly continuation = input.required<ConversationOnboardingContinuationPresentation>();
	/** The whole sanitized dialogue in the order the server recorded it. */
	public readonly entries = input.required<readonly ConversationOnboardingDialogueEntryPresentation[]>();
	/** Requests the normal new-session mode picker without changing the saved dialogue. */
	public readonly newChatRequested = output<void>();
}
