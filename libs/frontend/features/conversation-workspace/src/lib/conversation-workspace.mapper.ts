import { AvatarTones } from "@opencrane/elements/ui";
import { ConversationMessageTones, type ConversationMessagePresentation, type ConversationRichTextPresentation } from "@opencrane/elements/conversation";
import type { ConversationEntry, MessageEntry } from "@opencrane/contracts";
import { toSanitizedMarkdownHtml, toStreamingMarkdownHtml } from "@opencrane/state/conversation/render";
import { ConversationLifecycles, ConversationModes, ConversationPersonalAgentStatuses, MessageRoles, type ConversationCreationDirectory, type ConversationOnboardingHistory, type ConversationSummary } from "@opencrane/state/conversation/workspace";

import { ConversationOnboardingDialogueSpeakers, ConversationSessionRailIconStates, ConversationSessionRailItemKinds, type ConversationMessageView, type ConversationOnboardingContinuationPresentation, type ConversationOnboardingDialogueEntryPresentation, type ConversationOnboardingHistoryPresentation, type ConversationRailIdentityPresentation, type ConversationSessionRailItemPresentation, type ConversationSummaryPresentation } from "./conversation-workspace-feature.types";

/**
 * Builds one shared workspace presentation from a conversation summary.
 *
 * Titles and participant labels are generated here rather than taken from the server, so neither the
 * header nor the rail can print an opaque participant reference. Only the Agent-session title uses a
 * real name, and only the personal Agent's own display name.
 *
 * The `archived` flag keeps the conversation in the rail and selects its active or archived section;
 * the mode and participant labels remain available to the selected conversation header.
 *
 * Called by: `ConversationWorkspacePresenter._Summaries`, once per conversation in the store's list.
 * @param summary - One conversation from the workspace list.
 * @param personalAgentName - The signed-in user's personal Agent display name, or `null` when the
 * directory has no personal Agent. An Agent-session row falls back to the generic "Agent session"
 * title when this is `null`, so the row still reads sensibly during incomplete Agent setup.
 * @returns A row safe to render directly.
 */
export function _ConversationSummaryPresentation(summary: ConversationSummary, personalAgentName: string | null): ConversationSummaryPresentation
{
	const iconState = _ConversationSessionRailIconState(summary);
	switch (summary.mode)
	{
		case ConversationModes.AgentSession: return { id: summary.id, title: personalAgentName ?? "Agent session", modeLabel: "Agent session", participantLabel: "You and your Agent", iconState, archived: summary.archivedAt !== null };
		case ConversationModes.Direct: return { id: summary.id, title: "Direct conversation", modeLabel: "Direct", participantLabel: "You and Participant 1", iconState, archived: summary.archivedAt !== null };
		case ConversationModes.Group: return { id: summary.id, title: "Group conversation", modeLabel: "Group", participantLabel: `${summary.participantRefs.length} participants`, iconState, archived: summary.archivedAt !== null };
		default: return _UnsupportedConversationMode(summary.mode);
	}
}

/**
 * Combines completed onboarding and ordinary conversations into one visual session rail.
 * The onboarding row keeps a `null` conversation coordinate so selection cannot open conversation
 * commands for the saved Welcome dialogue.
 */
export function _ConversationSessionRailItems(summaries: readonly ConversationSummaryPresentation[], onboarding: ConversationOnboardingHistoryPresentation | null): readonly ConversationSessionRailItemPresentation[]
{
	const onboardingItems: readonly ConversationSessionRailItemPresentation[] = onboarding === null ? [] : [{ key: `onboarding:${onboarding.id}`, kind: ConversationSessionRailItemKinds.Onboarding, conversationId: null, title: "Welcome", iconState: ConversationSessionRailIconStates.Completed, archived: false }];
	const conversationItems = summaries.map(function _Conversation(summary): ConversationSessionRailItemPresentation
	{
		return { key: summary.id, kind: ConversationSessionRailItemKinds.Conversation, conversationId: summary.id, title: summary.title, iconState: summary.iconState, archived: summary.archived };
	});
	return [...onboardingItems, ...conversationItems];
}

/** Selects the rail prefix state while allowing a terminal lifecycle to override chat type. */
function _ConversationSessionRailIconState(summary: ConversationSummary): ConversationSessionRailIconStates
{
	if (summary.lifecycle === ConversationLifecycles.Closed)
		return ConversationSessionRailIconStates.Closed;
	switch (summary.mode)
	{
		case ConversationModes.AgentSession: return ConversationSessionRailIconStates.AgentSession;
		case ConversationModes.Direct: return ConversationSessionRailIconStates.Direct;
		case ConversationModes.Group: return ConversationSessionRailIconStates.Group;
		default: return _UnsupportedConversationMode(summary.mode);
	}
}

/** Refuses to reinterpret a future immutable conversation mode as an existing visual state. */
function _UnsupportedConversationMode(mode: never): never
{
	throw new Error(`Unsupported conversation mode: ${String(mode)}`);
}

/**
 * Maps the directory's generic self label into the optional rail footer.
 * Opaque participant references never enter the returned object; a missing self entry removes the
 * footer instead of guessing an identity.
 */
export function _ConversationRailIdentityPresentation(directory: ConversationCreationDirectory | null): ConversationRailIdentityPresentation | null
{
	const self = directory?.participants.find(participant => participant.isSelf);
	if (self === undefined)
		return null;
	return { name: self.label, detail: "Private workspace", initials: self.label === "You" ? "Y" : self.label.slice(0, 2).toUpperCase() };
}

/**
 * Builds the header copy for the completed onboarding exchange.
 *
 * The title is a fixed phrase rather than anything the server sent. The completion time passes
 * through the shared time formatter for the onboarding panel's completion divider.
 *
 * Called by: `ConversationWorkspacePresenter._OnboardingHistoryPresentation`, which calls this only
 * once it has confirmed the projection carries a transcript.
 * @param history - The completed exchange, which the caller has already checked is non-`null`.
 * @returns Header copy for the history panel. `completedLabel` reads
 * "Time unavailable" when the server's `completedAt` cannot be parsed as a date, since
 * {@link _TimeLabel} refuses to guess.
 * @see ConversationOnboardingHistoryPresentation
 */
export function _ConversationOnboardingHistoryPresentation(history: ConversationOnboardingHistory): ConversationOnboardingHistoryPresentation
{
	return { id: history.id, title: "Welcome to OpenCrane", completedLabel: _TimeLabel(history.completedAt) };
}

/**
 * Maps the current directory onto continuation copy for completed onboarding history.
 *
 * The action stays disabled unless the directory proves that an Agent session or a participant
 * conversation can be populated. `ConversationWorkspacePresenter` calls this mapper for the
 * read-only tray; tests call it directly to cover each directory state.
 */
export function _ConversationOnboardingContinuationPresentation(directory: ConversationCreationDirectory | null): ConversationOnboardingContinuationPresentation
{
	const heading = "This conversation is complete and read-only.";
	const detail = "Your onboarding answers stay here as a private chat.";
	if (directory === null)
		return { heading, detail, capabilityNote: "New-session availability could not be confirmed.", canStartNewChat: false };
	if (!directory.participants.some(participant => participant.isSelf))
		return { heading, detail, capabilityNote: "This account needs workspace membership before a new session can be started.", canStartNewChat: false };
	const hasParticipant = directory.participants.some(participant => !participant.isSelf);
	const hasReadyAgent = directory.personalAgentStatus === ConversationPersonalAgentStatuses.Ready && directory.personalAgent !== null;
	if (!hasParticipant && !hasReadyAgent)
		return { heading, detail, capabilityNote: "No participant or personal Agent is available for a new session.", canStartNewChat: false };
	if (directory.personalAgentStatus === ConversationPersonalAgentStatuses.Unavailable)
		return { heading, detail, capabilityNote: "Direct and group sessions are available. Agent sessions stay locked until setup is finished.", canStartNewChat: true };
	if (directory.personalAgentStatus === ConversationPersonalAgentStatuses.Ambiguous)
		return { heading, detail, capabilityNote: "Direct and group sessions are available while an administrator repairs the personal Agent assignment.", canStartNewChat: true };
	if (!hasParticipant)
		return { heading, detail, capabilityNote: "Start a new session to continue with your Agent.", canStartNewChat: true };
	if (!hasReadyAgent)
		return { heading, detail, capabilityNote: "Start a direct or group session to continue with other participants.", canStartNewChat: true };
	return { heading, detail, capabilityNote: "Start a new session with your Agent or other participants.", canStartNewChat: true };
}

/**
 * Turns the onboarding transcript into a dedicated guide-or-participant dialogue projection.
 *
 * These rows carry no conversation message id, per-line timestamp, Agent identity, or Agent thread.
 * The onboarding projection records only an order, a speaker, and text per line, so this mapping must
 * never grant reply, retry, run, archive, or thread-opening authority.
 *
 * Called by: `ConversationWorkspacePresenter._OnboardingDialogue`, which calls this only once
 * it has confirmed the projection carries a transcript.
 * @param history - The completed exchange, already in the order the server recorded it.
 * @returns One row per transcript line, in the server's order. Empty only if the server recorded an
 * empty exchange; the caller handles the "no transcript at all" case before reaching here.
 * @see _ConversationMessageViews for the separate mapping of real conversation messages.
 */
export function _ConversationOnboardingDialogueEntries(history: ConversationOnboardingHistory): readonly ConversationOnboardingDialogueEntryPresentation[]
{
	return history.transcript.map(function _Entry(entry): ConversationOnboardingDialogueEntryPresentation
	{
		const id = `onboarding-${history.id}-${entry.ordinal}`;
		const participant = entry.role === MessageRoles.User;
		const speaker = participant ? ConversationOnboardingDialogueSpeakers.Participant : ConversationOnboardingDialogueSpeakers.Guide;
		const label = participant ? "Your onboarding message" : "OpenCrane onboarding guide message";
		return { id, speaker, richText: { messageId: id, html: toSanitizedMarkdownHtml(entry.text), label } };
	});
}

/** Map immutable Kurrent history messages with server-resolved private payload text. */
export function _ConversationEntryViews(entries: readonly ConversationEntry[], payloads: Readonly<Record<string, string>>): readonly ConversationMessageView[]
{
	return entries.filter(function _Message(entry): entry is MessageEntry { return entry.kind === "message"; }).map(function _Entry(entry): ConversationMessageView
	{
		const text = entry.blocks.map(function _Block(block): string
		{
			if (block.kind === "text")
				return payloads[block.payloadRef] ?? "[Message text unavailable]";
			if (block.kind === "artifact")
				return `[${block.name}]`;
			return `[@${block.name}]`;
		}).join("\n\n");
		const authorName = entry.author.name;
		const authorInitials = _Initials(authorName);
		const authorPresentation = _EntryAuthorPresentation(entry.author.kind);
		const tone = authorPresentation.tone;
		const avatarTone = authorPresentation.avatarTone;
		const presentation: ConversationMessagePresentation = { id: entry.id, authorName, authorInitials, avatarTone, timestampLabel: _TimeLabel(entry.occurredAt), body: "", tone, accessibleStatus: entry.state === "completed" ? undefined : entry.state };
		const html = entry.state === "streaming" ? toStreamingMarkdownHtml(text) : toSanitizedMarkdownHtml(text);
		return { message: presentation, richText: { messageId: entry.id, html, label: `${authorName} message` } };
	});
}

/** Map a stamped author kind to presentation only; the server-stamped name remains authoritative history. */
function _EntryAuthorPresentation(kind: ConversationEntry["author"]["kind"]): { readonly avatarTone: AvatarTones; readonly tone: ConversationMessageTones }
{
	switch (kind)
	{
		case "human": return { avatarTone: AvatarTones.Blue, tone: ConversationMessageTones.Participant };
		case "agent": return { avatarTone: AvatarTones.Brand, tone: ConversationMessageTones.Agent };
		case "service":
		case "system": return { avatarTone: AvatarTones.Neutral, tone: ConversationMessageTones.System };
	}
}

/** Derive compact display initials without treating them as identity authority. */
function _Initials(name: string): string
{
	const words = name.trim().split(/\s+/u).filter(Boolean);
	return words.slice(0, 2).map(word => word[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Format a valid server instant without exposing locale-sensitive source fields. */
function _TimeLabel(value: string): string
{
	const date = new Date(value);
	if (Number.isNaN(date.getTime()))
		return "Time unavailable";
	return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}
