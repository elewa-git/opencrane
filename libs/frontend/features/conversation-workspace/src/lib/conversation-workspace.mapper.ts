import { AvatarTones } from "@opencrane/elements/ui";
import { ConversationMessageTones, type ConversationMessagePresentation, type ConversationRichTextPresentation } from "@opencrane/elements/conversation";
import { toSanitizedMarkdownHtml, toStreamingMarkdownHtml } from "@opencrane/state/conversation/render";
import { AgUiMessageStatuses, type AgUiMessageView } from "@opencrane/state/conversation/ag-ui";
import { ConversationModes, MessageRoles, MessageStates, type ConversationMessage, type ConversationOnboardingHistory, type ConversationSummary } from "@opencrane/state/conversation/workspace";

import type { ConversationMessageView, ConversationOnboardingHistoryPresentation, ConversationPresentationContext, ConversationSummaryPresentation } from "./conversation-workspace-feature.types.js";

/**
 * Builds one rail row from a conversation summary.
 *
 * Titles and participant labels are generated here rather than taken from the server, so the rail can
 * never print an opaque participant reference at a user. Only the Agent-session row uses a real name,
 * and only the personal Agent's own display name.
 *
 * The `archived` flag it sets is now load-bearing: archiving keeps the row in the list instead of
 * removing it, and the rail uses this flag to decide whether the row belongs in the Active or the
 * Archived section.
 *
 * Called by: `ConversationWorkspacePresenter._Summaries`, once per conversation in the store's list.
 * @param summary - One conversation from the workspace list.
 * @param personalAgentName - The signed-in user's personal Agent display name, or `null` when the
 * directory has no personal Agent. An Agent-session row falls back to the generic "Agent session"
 * title when this is `null`, so the row still reads sensibly during incomplete Agent setup.
 * @returns A row safe to render directly. `updatedLabel` reads "Time unavailable" when the server's
 * `updatedAt` cannot be parsed.
 */
export function _ConversationSummaryPresentation(summary: ConversationSummary, personalAgentName: string | null): ConversationSummaryPresentation
{
	const updatedLabel = _TimeLabel(summary.updatedAt);
	if (summary.mode === ConversationModes.AgentSession) return { id: summary.id, title: personalAgentName ?? "Agent session", modeLabel: "Agent session", participantLabel: "You and your Agent", updatedLabel, archived: summary.archivedAt !== null };
	if (summary.mode === ConversationModes.Direct) return { id: summary.id, title: "Direct conversation", modeLabel: "Direct", participantLabel: "You and Participant 1", updatedLabel, archived: summary.archivedAt !== null };
	return { id: summary.id, title: "Group conversation", modeLabel: "Group", participantLabel: `${summary.participantRefs.length} participants`, updatedLabel, archived: summary.archivedAt !== null };
}

/**
 * Builds the header copy for the completed onboarding exchange.
 *
 * The title is a fixed phrase rather than anything the server sent, because the rail lists this row
 * next to Direct, Group and Agent-session rows and a server-supplied title could read as a fourth
 * mode. The persona name and completion time do come from the server, and the time is put through the
 * same formatter the conversation rows use so both read alike.
 *
 * Called by: `ConversationWorkspacePresenter._OnboardingHistoryPresentation`, which calls this only
 * once it has confirmed the projection carries a transcript.
 * @param history - The completed exchange, which the caller has already checked is non-`null`.
 * @returns Header copy for the rail row and the history panel. `completedLabel` reads
 * "Time unavailable" when the server's `completedAt` cannot be parsed as a date, since
 * {@link _TimeLabel} refuses to guess.
 * @see ConversationOnboardingHistoryPresentation
 */
export function _ConversationOnboardingHistoryPresentation(history: ConversationOnboardingHistory): ConversationOnboardingHistoryPresentation
{
	return { id: history.id, title: "Welcome conversation", personaName: history.personaDisplayName, completedLabel: _TimeLabel(history.completedAt) };
}

/**
 * Turns the onboarding transcript into the same row shape the conversation transcript uses, so the
 * history panel can reuse the shared message and rich-text elements.
 *
 * The output only looks like conversation messages — none of these rows is one. They carry no server
 * message id, no per-line timestamp and no Agent thread, because the onboarding projection records
 * only an order, a speaker and text per line. So a reader must not feed these rows back into anything
 * that expects a real {@link ConversationMessage}: there is nothing on the server to reply to, retry
 * or open.
 *
 * Called by: `ConversationWorkspacePresenter._OnboardingHistoryMessages`, which calls this only once
 * it has confirmed the projection carries a transcript.
 * @param history - The completed exchange, already in the order the server recorded it.
 * @returns One row per transcript line, in the server's order. Empty only if the server recorded an
 * empty exchange; the caller handles the "no transcript at all" case before reaching here.
 * @see _ConversationMessageViews for the equivalent mapping of real conversation messages.
 */
export function _ConversationOnboardingHistoryMessageViews(history: ConversationOnboardingHistory): readonly ConversationMessageView[]
{
	return history.transcript.map(function _Entry(entry): ConversationMessageView
	{
		// 1. Pick the display identity from the recorded speaker. The assistant is named after the
		// persona the user actually onboarded with, so the transcript reads back as the same
		// conversation they had rather than a generic "Agent".
		const assistant = entry.role === MessageRoles.Assistant;
		const author = assistant
			? { name: history.personaDisplayName, initials: "A", avatarTone: AvatarTones.Brand, tone: ConversationMessageTones.Agent }
			: { name: "You", initials: "Y", avatarTone: AvatarTones.Brand, tone: ConversationMessageTones.Participant };

		// 2. Build an id from the exchange id and the line's ordinal. The server sends no id per line,
		// and both the template's `@for` track and the rich-text element's `messageId` need a stable
		// one that does not change between renders.
		const id = `onboarding-${history.id}-${entry.ordinal}`;

		// 3. Fill the shared row. `body` stays empty and the text goes through the rich-text slot, which
		// is how the conversation transcript renders markdown too. Sanitizing rather than
		// streaming-rendering is correct here because a completed exchange has no partial line left to
		// arrive. `timestampLabel` is the word "Onboarding" because the server records one completion
		// time for the whole exchange and none per line; that single time shows in the panel header.
		return {
			message: { id, authorName: author.name, authorInitials: author.initials, avatarTone: author.avatarTone, timestampLabel: "Onboarding", body: "", tone: author.tone },
			richText: { messageId: id, html: toSanitizedMarkdownHtml(entry.text), label: `${author.name} onboarding message` },
			agentThread: null
		};
	});
}

/** Map one canonical message to shared element models and sanitized markdown. */
export function _ConversationMessageView(message: ConversationMessage, context: ConversationPresentationContext): ConversationMessageView
{
	const selfRef = context.directory?.participants.find(participant => participant.isSelf)?.participantRef ?? null;
	const author = _Author(message, selfRef, context.summary.participantRefs);
	const copy = message.blocks.map(function _Text(block) { return block.kind === "text" ? block.value : `[${block.kind.replaceAll("_", " ")}]`; }).join("\n\n");
	const html = message.state === MessageStates.Streaming ? toStreamingMarkdownHtml(copy) : toSanitizedMarkdownHtml(copy);
	const presentation: ConversationMessagePresentation = { id: message.id, authorName: author.name, authorInitials: author.initials, avatarTone: author.avatarTone, timestampLabel: _TimeLabel(message.createdAt), body: "", tone: author.tone, accessibleStatus: message.state === MessageStates.Completed ? undefined : message.state };
	const richText: ConversationRichTextPresentation = { messageId: message.id, html, label: `${author.name} message` };
	return { message: presentation, richText, agentThread: message.agentThread };
}

/** Map canonical messages using stable participant numbering within the selected conversation. */
export function _ConversationMessageViews(messages: readonly ConversationMessage[], context: ConversationPresentationContext): readonly ConversationMessageView[]
{
	return messages.map(function _Message(message) { return _ConversationMessageView(message, context); });
}

/** Map live AG-UI messages not yet present in the bounded canonical snapshot. */
export function _LiveMessageViews(messages: readonly AgUiMessageView[]): readonly ConversationMessageView[]
{
	return messages.map(function _Message(message): ConversationMessageView
	{
		const agent = message.role === MessageRoles.Assistant;
		const author = _LiveAuthor(agent);
		const presentation: ConversationMessagePresentation = { id: message.id, authorName: author.name, authorInitials: author.initials, avatarTone: author.avatarTone, timestampLabel: "Now", body: "", tone: author.tone, accessibleStatus: message.status };
		const html = message.status === AgUiMessageStatuses.Streaming ? toStreamingMarkdownHtml(message.text) : toSanitizedMarkdownHtml(message.text);
		return { message: presentation, richText: { messageId: message.id, html, label: `${author.name} message` }, agentThread: null };
	});
}

/** Select the fixed display identity for one admitted live message role. */
function _LiveAuthor(agent: boolean): { readonly name: string; readonly initials: string; readonly avatarTone: AvatarTones; readonly tone: ConversationMessageTones }
{
	if (agent) return { name: "Agent", initials: "A", avatarTone: AvatarTones.Brand, tone: ConversationMessageTones.Agent };
	return { name: "OpenCrane", initials: "OC", avatarTone: AvatarTones.Neutral, tone: ConversationMessageTones.System };
}

/** Select display-only authorship without using a role as identity authority. */
function _Author(message: ConversationMessage, selfRef: string | null, participantRefs: readonly string[]): { readonly name: string; readonly initials: string; readonly avatarTone: AvatarTones; readonly tone: ConversationMessageTones }
{
	if (message.participantRef !== null)
	{
		if (message.participantRef === selfRef) return { name: "You", initials: "Y", avatarTone: AvatarTones.Brand, tone: ConversationMessageTones.Participant };
		const others = participantRefs.filter(reference => reference !== selfRef);
		const index = others.indexOf(message.participantRef);
		const number = index < 0 ? 1 : index + 1;
		return { name: `Participant ${number}`, initials: `P${number}`, avatarTone: AvatarTones.Blue, tone: ConversationMessageTones.Participant };
	}
	if (message.role === MessageRoles.Assistant || message.runId !== null) return { name: "Agent", initials: "A", avatarTone: AvatarTones.Brand, tone: ConversationMessageTones.Agent };
	return { name: "OpenCrane", initials: "OC", avatarTone: AvatarTones.Neutral, tone: ConversationMessageTones.System };
}

/** Format a valid server instant without exposing locale-sensitive source fields. */
function _TimeLabel(value: string): string
{
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Time unavailable";
	return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}
