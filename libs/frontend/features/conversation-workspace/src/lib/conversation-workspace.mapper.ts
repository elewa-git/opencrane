import { AvatarTones } from "@opencrane/elements/ui";
import { ConversationMessageTones, type ConversationMessagePresentation, type ConversationRichTextPresentation } from "@opencrane/elements/conversation";
import { toSanitizedMarkdownHtml, toStreamingMarkdownHtml } from "@opencrane/state/conversation/render";
import { AgUiMessageStatuses, type AgUiMessageView } from "@opencrane/state/conversation/ag-ui";
import { ConversationModes, MessageRoles, MessageStates, type ConversationMessage, type ConversationSummary } from "@opencrane/state/conversation/workspace";

import type { ConversationMessageView, ConversationPresentationContext, ConversationSummaryPresentation } from "./conversation-workspace-feature.types.js";

/** Map one list summary without displaying opaque participant coordinates. */
export function _ConversationSummaryPresentation(summary: ConversationSummary, personalAgentName: string | null): ConversationSummaryPresentation
{
	const updatedLabel = _TimeLabel(summary.updatedAt);
	if (summary.mode === ConversationModes.AgentSession) return { id: summary.id, title: personalAgentName ?? "Agent session", modeLabel: "Agent session", participantLabel: "You and your Agent", updatedLabel, archived: summary.archivedAt !== null };
	if (summary.mode === ConversationModes.Direct) return { id: summary.id, title: "Direct conversation", modeLabel: "Direct", participantLabel: "You and Participant 1", updatedLabel, archived: summary.archivedAt !== null };
	return { id: summary.id, title: "Group conversation", modeLabel: "Group", participantLabel: `${summary.participantRefs.length} participants`, updatedLabel, archived: summary.archivedAt !== null };
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
