import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationMessageComponent, ConversationRichTextComponent } from "@opencrane/elements/conversation";

import type { ConversationMessageView, ConversationOnboardingHistoryPresentation } from "../../conversation-workspace-feature.types";

/**
 * Shows the completed onboarding exchange as read-only history in the main area of the chat
 * workspace.
 *
 * You see this component when the signed-in user has finished onboarding: the workspace store selects
 * history by default on load, so this is the first thing a newly onboarded user meets under `/chats`.
 * It takes the place of the conversation transcript, and it deliberately carries none of the controls
 * that transcript has — no composer, no attachment tray, no run actions, no Archive or Close. There is
 * nothing to send into, because the exchange is already finished and the server keeps no conversation
 * behind it to write to. The only way forward is the `newChatRequested` button, which starts an
 * ordinary conversation and leaves this history untouched.
 *
 * Both inputs are `required`, so the parent must only create this component once it holds a real
 * transcript. The workspace page enforces that by rendering it under
 * `@if (store.onboardingHistorySelected() && onboardingHistoryPresentation(); as history)`.
 *
 * Called by: the `wo-conversation-onboarding-history` element in
 * `conversation-workspace-page.component.html`. Nothing else instantiates it, and it is not exported
 * from the library barrel.
 * @see ConversationOnboardingHistoryPresentation for the header copy it renders.
 * @see The `ConversationOnboardingHistoryStatuses` enum in `@opencrane/state/conversation/workspace`
 * for the states in which no transcript exists to show.
 */
@Component({ selector: "wo-conversation-onboarding-history", standalone: true, imports: [ButtonModule, ConversationMessageComponent, ConversationRichTextComponent], templateUrl: "./conversation-onboarding-history.component.html", styleUrl: "./conversation-onboarding-history.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationOnboardingHistoryComponent
{
	/** Heading, persona name and completion time, already formatted by the feature mapper. */
	public readonly presentation = input.required<ConversationOnboardingHistoryPresentation>();
	/**
	 * The whole transcript, in the order the server recorded it.
	 *
	 * The component renders these straight through and never sorts them: the server sends a one-based
	 * `ordinal` per line and the mapper preserves that order, so re-sorting here could only make the
	 * exchange read wrongly. The markdown in each row is already sanitized by the mapper.
	 */
	public readonly messages = input.required<readonly ConversationMessageView[]>();
	/**
	 * Fires when the user presses "Start a new chat", from either the header or the footer.
	 *
	 * The workspace page handles this with `showCreate()` — the same handler the rail's "New" button
	 * uses — so this opens the normal mode-choice dialog rather than a path special to onboarding.
	 * History stays selected and unchanged until the user actually creates something.
	 */
	public readonly newChatRequested = output<void>();
}
