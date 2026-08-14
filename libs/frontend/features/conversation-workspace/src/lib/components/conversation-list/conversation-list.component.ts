import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ConversationOnboardingHistoryStatuses } from "@opencrane/state/conversation/workspace";

import type { ConversationOnboardingHistoryPresentation, ConversationSummaryPresentation } from "../../conversation-workspace-feature.types";

/**
 * Draws the left rail of the chat workspace and reports what the user picked.
 *
 * The rail holds three sections that stay visually separate on purpose: the completed onboarding
 * history, then active conversations, then archived ones. Keeping them apart is what stops a finished
 * onboarding exchange from reading as a normal chat and an archived chat from reading as a live one —
 * they behave differently when selected, so they must not sit in one undifferentiated list.
 *
 * The component holds no state and reads no store. It emits which row the user pressed and lets the
 * workspace page decide whether the selection is allowed and what the URL becomes. The two selection
 * inputs are never both set: selecting history clears the conversation selection in the store, and
 * opening a conversation clears the history selection, so exactly one row can show as current.
 *
 * Called by: the `wo-conversation-list` element in `conversation-workspace-page.component.html`.
 * Storybook also drives it directly from `__tests__/conversation-workspace.stories.ts`.
 * @see ConversationOnboardingHistoryStatuses for what each empty-history message means.
 */
@Component({ selector: "wo-conversation-list", standalone: true, imports: [ButtonModule], templateUrl: "./conversation-list.component.html", styleUrl: "./conversation-list.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ConversationListComponent
{
	/**
	 * Every conversation row the user may see, active and archived together.
	 *
	 * Archiving no longer drops a row from this list — the store replaces it with the archived
	 * projection — so the template splits the rows itself on `archived` and shows the Archived section
	 * only when at least one row falls into it. A caller must therefore not pre-filter archived rows out,
	 * or that section becomes permanently empty.
	 */
	public readonly items = input<readonly ConversationSummaryPresentation[]>([]);
	/**
	 * Header copy for the onboarding history row, or `null` when there is no transcript to offer.
	 *
	 * When this is `null` the template falls back to {@link onboardingHistoryStatus} to say why the row
	 * is missing, so the two inputs are read together rather than independently.
	 */
	public readonly onboardingHistory = input<ConversationOnboardingHistoryPresentation | null>(null);
	/**
	 * Why the onboarding history row is missing, so the rail can explain instead of showing nothing.
	 *
	 * The default is `Unavailable` to match the store's own starting value and its behaviour when the
	 * history read throws. That makes an unbound or not-yet-loaded rail say "unavailable right now"
	 * rather than imply onboarding was never completed — a claim this component cannot verify.
	 */
	public readonly onboardingHistoryStatus = input(ConversationOnboardingHistoryStatuses.Unavailable);
	/** Whether the onboarding history row is the current selection, driving its highlight and `aria-current`. */
	public readonly onboardingSelected = input(false);
	/**
	 * Currently selected conversation, or `null`.
	 *
	 * This is `null` for the whole time onboarding history is selected, because the store drops its
	 * conversation selection when it opens history. Do not treat `null` as "nothing selected" without
	 * also checking {@link onboardingSelected}.
	 */
	public readonly selectedId = input<string | null>(null);
	/** Fires when the user presses "New", asking the page to open the mode-choice dialog. */
	public readonly createRequested = output<void>();
	/**
	 * Fires with the id of the conversation row the user pressed, from either the Active or the
	 * Archived section. The page still has to load and authorise that conversation, so pressing a row
	 * is a request, not a completed selection.
	 */
	public readonly selected = output<string>();
	/**
	 * Fires when the user presses the onboarding history row.
	 *
	 * It carries no id: history is not a conversation and the page has nothing to look up, it only
	 * switches the workspace to the transcript it already holds.
	 */
	public readonly onboardingHistorySelected = output<void>();
	/** Exposes the status enum to the template, which cannot reference the imported symbol directly. */
	protected readonly historyStatuses = ConversationOnboardingHistoryStatuses;
}
