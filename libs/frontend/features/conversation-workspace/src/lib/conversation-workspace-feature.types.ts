import type { ConversationMessage, ConversationSummary } from "@opencrane/state/conversation/workspace";

/**
 * Selects the server-backed source a session-rail row opens.
 *
 * The distinction prevents the Welcome row from becoming a fake Conversation coordinate while the
 * rail still presents both sources under My sessions.
 */
export enum ConversationSessionRailItemKinds
{
	/** A completed onboarding exchange projected into the rail without becoming a Conversation. */
	Onboarding = "onboarding",
	/** A normal direct, group, or Agent-session conversation. */
	Conversation = "conversation"
}

/**
 * Selects the side that renders a saved onboarding line.
 *
 * This state aligns guide text and participant bubbles without claiming that the guide is an
 * assigned personal Agent.
 */
export enum ConversationOnboardingDialogueSpeakers
{
	/** The reviewed onboarding guide authored the line; this does not imply an assigned Agent. */
	Guide = "guide",
	/** The signed-in participant authored the line. */
	Participant = "participant"
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

/** One visually unified row in the workspace's My sessions rail. */
export interface ConversationSessionRailItemPresentation
{
	/** Stable browser key; onboarding keys never become conversation route coordinates. */
	readonly key: string;
	/** Server-backed source kind used by the page to delegate the correct selection intent. */
	readonly kind: ConversationSessionRailItemKinds;
	/** Conversation coordinate for ordinary rows, or `null` for completed onboarding. */
	readonly conversationId: string | null;
	/** Short participant-facing row title. */
	readonly title: string;
	/** Secondary read-only, mode, or participant detail. */
	readonly detail: string;
	/** Preformatted last-update or completion time. */
	readonly updatedLabel: string;
	/** Whether the participant archived this ordinary conversation row. */
	readonly archived: boolean;
}

/** Exact selection request emitted by the presentation-only session rail. */
export interface ConversationSessionRailSelectionIntent
{
	/** Source kind that selects the page's onboarding or conversation path. */
	readonly kind: ConversationSessionRailItemKinds;
	/** Conversation coordinate for ordinary rows, or `null` for onboarding. */
	readonly conversationId: string | null;
}

/** Generic directory-derived self label shown at the bottom of the session rail. */
export interface ConversationRailIdentityPresentation
{
	/** Generic self label already admitted by the conversation directory. */
	readonly name: string;
	/** Fixed workspace context that contains no identity or tenant data. */
	readonly detail: string;
	/** Display initials derived only from the generic self label. */
	readonly initials: string;
}

/**
 * Display-ready header copy for the completed onboarding exchange.
 *
 * The server keeps onboarding outside the ordinary Conversation lifecycle. The workspace therefore
 * maps it into one read-only Welcome session without inventing a conversation coordinate, participant
 * count, archive state, or composer authority.
 *
 * Called by: `_ConversationOnboardingHistoryPresentation` builds this projection and
 * `ConversationOnboardingHistoryComponent` renders its header.
 * @see ConversationSessionRailItemPresentation for the visually unified rail row.
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
	/** Fixed heading shown above the completed private onboarding dialogue. */
	readonly title: string;
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
	/** Capability note shown below the read-only tray. */
	readonly capabilityNote: string;
	/** Whether the existing immutable-mode creation dialog may be opened from this account state. */
	readonly canStartNewChat: boolean;
}

/** One sanitized line in the dedicated completed-onboarding dialogue. */
export interface ConversationOnboardingDialogueEntryPresentation
{
	/** Stable browser key derived from the onboarding exchange and server ordinal. */
	readonly id: string;
	/** Speaker category controlling participant alignment without inventing Agent identity. */
	readonly speaker: ConversationOnboardingDialogueSpeakers;
	/** Sanitized rich-text body rendered through the shared conversation element. */
	readonly richText: import("@opencrane/elements/conversation").ConversationRichTextPresentation;
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
