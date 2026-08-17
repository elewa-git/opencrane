import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { ConversationMessageComponent, ConversationRichTextComponent } from "@opencrane/elements/conversation";
import { ScopeChipAppearances, ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";

import type { ConversationMessageView, ConversationOnboardingContinuationPresentation, ConversationOnboardingHistoryPresentation } from "../../conversation-workspace-feature.types";
import { ConversationOnboardingContinuationComponent } from "../conversation-onboarding-continuation/conversation-onboarding-continuation.component";

/**
 * Shows the completed onboarding exchange as read-only history inside the chat workspace.
 *
 * The server projection cannot accept conversation commands, so this component replaces the normal
 * controls with a continuation intent while the presenter decides whether that intent is available.
 * Called by: `conversation-workspace-page.component.html` when onboarding history is selected.
 * @see ConversationOnboardingHistoryPresentation for the header copy it renders.
 * @see ConversationOnboardingContinuationPresentation for the directory-derived action state.
 */
@Component({ selector: "wo-conversation-onboarding-history", standalone: true, imports: [ConversationMessageComponent, ConversationOnboardingContinuationComponent, ConversationRichTextComponent, ScopeChipComponent], templateUrl: "./conversation-onboarding-history.component.html", styleUrl: "./conversation-onboarding-history.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationOnboardingHistoryComponent
{
	/** Success tone used by the completed status chip. */
	public readonly chipTone = ScopeChipTones.Success;
	/** Soft chip appearance keeps completion visible without competing with the transcript. */
	public readonly chipAppearance = ScopeChipAppearances.Soft;
	/** Heading, persona name and completion time, already formatted by the feature mapper. */
	public readonly presentation = input.required<ConversationOnboardingHistoryPresentation>();
	/** Read-only boundary and next-step availability derived by the feature presenter. */
	public readonly continuation = input.required<ConversationOnboardingContinuationPresentation>();
	/**
	 * The whole transcript, in the order the server recorded it.
	 *
	 * The component renders these straight through and never sorts them: the server sends a one-based
	 * `ordinal` per line and the mapper preserves that order, so re-sorting here could only make the
	 * exchange read wrongly. The markdown in each row is already sanitized by the mapper.
	 */
	public readonly messages = input.required<readonly ConversationMessageView[]>();
	/**
	 * Fires when the user presses the read-only tray's "Start a new chat" action.
	 *
	 * The workspace page handles this with `showCreate()` — the same handler the rail's "New" button
	 * uses — so this opens the normal mode-choice dialog rather than a path special to onboarding.
	 * History stays selected and unchanged until the user actually creates something.
	 */
	public readonly newChatRequested = output<void>();
}
