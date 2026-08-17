import type { ConversationMessage, ConversationSummary } from "@opencrane/state/conversation/workspace";

/**
 * Selects which workspace regions are present for the current authoritative projection.
 *
 * {@link ConversationWorkspacePresenter} derives this memory-only value and the page template
 * branches on it. It is not persisted or sent over an API, and typed callers must use one of the
 * two compositions below.
 */
export enum ConversationWorkspaceLayouts
{
	/** The page shows an ordinary conversation with its optional Activity and Files rail. */
	Standard = "standard",
	/** The page shows completed onboarding with the conversation rail and read-only main panel. */
	OnboardingHistory = "onboarding_history"
}

/** Generic privacy-safe list row shown in the workspace rail. */
export interface ConversationSummaryPresentation
{
	/** Stable conversation coordinate used for selection. */
	readonly id: string;
	/** Generic or server-approved title. */
	readonly title: string;
	/** Plain immutable-mode label. */
	readonly modeLabel: string;
	/** Plain participant-count detail. */
	readonly participantLabel: string;
	/** Preformatted update time. */
	readonly updatedLabel: string;
	/** Whether this participant archived the row. */
	readonly archived: boolean;
}

/**
 * Display-ready copy for the completed onboarding exchange, used by both the rail row and the
 * history panel header.
 *
 * The workspace shows a finished onboarding exchange as read-only history rather than as another
 * conversation mode beside Direct, Group and Agent session. That is why this is a separate interface
 * instead of another {@link ConversationSummaryPresentation} row: history has no lifecycle, no
 * participant count, no archive state and nothing to send into. Every field is already formatted, so
 * neither component needs the server times or the onboarding projection behind them.
 *
 * Called by: `_ConversationOnboardingHistoryPresentation` in `conversation-workspace.mapper.ts` builds
 * it, `ConversationListComponent` takes it as the `onboardingHistory` input for the rail row, and
 * `ConversationOnboardingHistoryComponent` takes it as the `presentation` input for its header.
 * @see The `ConversationOnboardingHistory` projection in `@opencrane/state/conversation/workspace`,
 * which this is mapped from.
 */
export interface ConversationOnboardingHistoryPresentation
{
	/**
	 * Key for Angular tracking and DOM ids, taken from the onboarding projection.
	 *
	 * This is not a conversation coordinate. No conversation API accepts it and it never reaches a
	 * URL — selecting history puts the plain `/chats` index in the address bar instead of a
	 * conversation path.
	 */
	readonly id: string;
	/**
	 * Heading shown for the exchange. The mapper sets a fixed phrase rather than passing server copy
	 * through, so a reader cannot mistake the history row for one of the conversation modes listed
	 * beside it.
	 */
	readonly title: string;
	/** Persona name the server approved during onboarding, shown as the author of every assistant line. */
	readonly personaName: string;
	/**
	 * Time onboarding was completed, already formatted for display.
	 *
	 * This is the only clock reading the panel can show: the server records one completion time for
	 * the whole exchange and no timestamp per line, so individual messages are labelled without one.
	 */
	readonly completedLabel: string;
}

/** Read-only continuation copy shown where the completed onboarding composer used to be. */
export interface ConversationOnboardingContinuationPresentation
{
	/** Stable terminal-state heading that does not imply the exchange can reopen. */
	readonly heading: string;
	/** Plain next-step explanation derived from the current workspace and Agent directory state. */
	readonly detail: string;
	/** Whether the existing immutable-mode creation dialog may be opened from this account state. */
	readonly canStartNewChat: boolean;
}

/** Full display-safe presentation for one canonical transcript row. */
export interface ConversationMessageView
{
	/** Shared message element presentation. */
	readonly message: import("@opencrane/elements/conversation").ConversationMessagePresentation;
	/** Sanitized rich-text projection rendered inside the shared rich-card slot. */
	readonly richText: import("@opencrane/elements/conversation").ConversationRichTextPresentation;
	/** Child route coordinates when this message invoked an Agent. */
	readonly agentThread: ConversationMessage["agentThread"];
}

/** Route intent for opening one child Agent session from its parent message. */
export interface ConversationThreadNavigationIntent
{
	/** Parent group conversation coordinate. */
	readonly parentConversationId: string;
	/** Child Agent-session coordinate. */
	readonly childConversationId: string;
	/** Parent root-message coordinate restored on return. */
	readonly parentMessageId: string;
}

/** Inputs needed to map generic labels without interpreting opaque references. */
export interface ConversationPresentationContext
{
	/** Current privacy-safe creation directory. */
	readonly directory: import("@opencrane/state/conversation/workspace").ConversationCreationDirectory | null;
	/** Selected summary carrying immutable mode and participant count. */
	readonly summary: ConversationSummary;
}

/** Explicit workspace availability copy derived from the existing privacy-safe directory. */
export interface ConversationWorkspaceAvailabilityPresentation
{
	/** Short state heading. */
	readonly heading: string;
	/** Plain explanation that does not disclose hidden identities. */
	readonly detail: string;
}
