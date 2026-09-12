import { AvatarTones } from "@opencrane/elements/ui";
import { ConversationMessageTones, ConversationStatusTones, type ConversationMessagePresentation, type ConversationRichTextPresentation, type ConversationStatusPresentation } from "@opencrane/elements/conversation";
import { ConversationEntryKinds, ConversationMessageContentBlockKinds, type ArtifactMessageContentBlock, type ConversationEntry, type ToolCallLogEntry } from "@opencrane/contracts";
import { ConversationAssetPresentationStates, type ConversationAssetPresentation } from "@opencrane/features/conversation-assets";
import { ConversationAssetProvenance } from "@opencrane/models/conversation-assets";
import { toSanitizedMarkdownHtml, toStreamingMarkdownHtml } from "@opencrane/state/conversation/render";
import { ConversationAssetContentCommandStates } from "@opencrane/state/conversation/assets";
import { ConversationLifecycles, ConversationModes, ConversationPersonalAgentStatuses, MessageRoles, MessageStates, type ConversationCreationDirectory, type ConversationOnboardingHistory, type ConversationSummary } from "@opencrane/state/conversation/workspace";

import { ConversationOnboardingDialogueSpeakers, ConversationSessionRailIconStates, ConversationSessionRailItemKinds, type ConversationOnboardingContinuationPresentation, type ConversationOnboardingDialogueEntryPresentation, type ConversationOnboardingHistoryPresentation, type ConversationRailIdentityPresentation, type ConversationSessionRailItemPresentation, type ConversationSummaryPresentation } from "./conversation-workspace-feature.types";
import { ConversationWorkspaceTranscriptEntryKinds, type ConversationWorkspaceTranscriptEntry } from "./presentation/conversation-workspace-presentation.types";

/** Schema-owned discriminant for the canonical tool-call log variant. */
const _TOOL_CALL_LOG_KIND: ToolCallLogEntry["logKind"] = "tool_call";

/**
 * Uses the current directory to name conversations in both the rail and selected header.
 * Missing members receive a generic label; membership references never become display text.
 * Group titles show two names and the number of other people to keep the rail readable.
 * @param directory The current member and personal-assistant directory, or null while unavailable.
 */
export function _ConversationSummaryPresentation(summary: ConversationSummary, directory: ConversationCreationDirectory | null): ConversationSummaryPresentation
{
	const iconState = _ConversationSessionRailIconState(summary);
	const peerLabels = _conversationPeerLabels(summary, directory);
	switch (summary.mode)
	{
		case ConversationModes.AgentSession:
		{
			const companyAssistant = directory?.companyAssistants.find(assistant => assistant.agentServiceId === summary.agentServiceId);
			const personalName = directory?.personalAgent?.personalAgentRef === summary.agentServiceId ? directory.personalAgent.displayName : null;
			if (personalName !== null)
				return { id: summary.id, title: personalName, modeLabel: "Agent session", participantLabel: "You and your Agent", iconState, archived: summary.archivedAt !== null };
			return { id: summary.id, title: companyAssistant?.displayName ?? "Assistant conversation", modeLabel: "Company assistant", participantLabel: `Shared assistant chat · ${summary.participantRefs.length} participants`, iconState, archived: summary.archivedAt !== null };
		}
		case ConversationModes.Direct: return { id: summary.id, title: peerLabels[0] ?? "Direct conversation", modeLabel: "Direct", participantLabel: peerLabels.length === 0 ? `${summary.participantRefs.length} participants` : `You and ${peerLabels[0]}`, iconState, archived: summary.archivedAt !== null };
		case ConversationModes.Group: return { id: summary.id, title: _compactParticipantNames(peerLabels) || "Group conversation", modeLabel: "Group", participantLabel: `${summary.participantRefs.length} participants`, iconState, archived: summary.archivedAt !== null };
		default: return _UnsupportedConversationMode(summary.mode);
	}
}

/** Finds each other participant in conversation order, retaining a label for unavailable members. */
function _conversationPeerLabels(summary: ConversationSummary, directory: ConversationCreationDirectory | null): readonly string[]
{
	if (directory === null)
		return [];
	const members = new Map(directory.participants.map(participant => [participant.participantRef, participant]));
	return summary.participantRefs.filter(reference => !members.get(reference)?.isSelf).map(reference => members.get(reference)?.label ?? "Participant");
}

/** Limits the visible names without hiding how many other people belong to the conversation. */
function _compactParticipantNames(labels: readonly string[]): string
{
	const names = labels.slice(0, 2).join(", ");
	return labels.length > 2 ? `${names} +${labels.length - 2}` : names;
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

/** Map immutable Kurrent messages and the latest fact for each tool call in canonical order. */
export function _ConversationEntryViews(entries: readonly ConversationEntry[], payloads: Readonly<Record<string, string>>, assets: readonly ConversationAssetPresentation[] = []): readonly ConversationWorkspaceTranscriptEntry[]
{
	const latestTools = new Map<string, ToolCallLogEntry>();
	for (const entry of entries)
		if (entry.kind === ConversationEntryKinds.Log && entry.logKind === _TOOL_CALL_LOG_KIND)
			latestTools.set(entry.toolCallId, entry);
	return entries.flatMap(function _Entry(entry): readonly ConversationWorkspaceTranscriptEntry[]
	{
		if (entry.kind === ConversationEntryKinds.Log && entry.logKind === _TOOL_CALL_LOG_KIND)
			return latestTools.get(entry.toolCallId)?.id === entry.id ? [{ kind: ConversationWorkspaceTranscriptEntryKinds.ToolActivity, id: entry.id, status: _ConversationToolStatus(entry) }] : [];
		if (entry.kind !== ConversationEntryKinds.Message)
			return [];
		const text = entry.blocks.flatMap(function _Block(block): readonly string[]
		{
			if (block.kind === ConversationMessageContentBlockKinds.Text)
				return [payloads[block.payloadRef] ?? "[Message text unavailable]"];
			if (block.kind === ConversationMessageContentBlockKinds.Artifact)
				return [];
			return [`[@${block.name}]`];
		}).join("\n\n");
		const attachments = entry.blocks.filter(function _Artifact(block): block is ArtifactMessageContentBlock { return block.kind === ConversationMessageContentBlockKinds.Artifact; }).map(block => _ConversationArtifact(block, entry.id, assets));
		const authorName = entry.author.name;
		const authorInitials = _Initials(authorName);
		const authorPresentation = _EntryAuthorPresentation(entry.author.kind);
		const tone = authorPresentation.tone;
		const avatarTone = authorPresentation.avatarTone;
		const presentation: ConversationMessagePresentation = { id: entry.id, authorName, authorInitials, avatarTone, timestampLabel: _TimeLabel(entry.occurredAt), body: "", tone, accessibleStatus: entry.state === MessageStates.Completed ? undefined : entry.state };
		const html = entry.state === MessageStates.Streaming ? toStreamingMarkdownHtml(text) : toSanitizedMarkdownHtml(text);
		return [{ kind: ConversationWorkspaceTranscriptEntryKinds.Message, id: entry.id, message: presentation, richText: { messageId: entry.id, html, label: `${authorName} message` }, requestSource: null, shareSource: null, children: [], attachments }];
	});
}

/** Joins one immutable artifact block to a currently authorized asset without using display text as identity. */
function _ConversationArtifact(block: ArtifactMessageContentBlock, messageId: string, assets: readonly ConversationAssetPresentation[]): ConversationAssetPresentation
{
	const matches = assets.filter(asset => asset.artifactId === block.artifactId && asset.artifactRevisionId === block.artifactRevisionId && asset.messageId === messageId);
	if (matches.length === 1 && matches[0]?.displayName === block.name && matches[0].mediaType === block.mediaType)
		return matches[0];
	return { id: block.id, messageId, artifactId: block.artifactId, artifactRevisionId: block.artifactRevisionId, provenance: ConversationAssetProvenance.ParticipantUpload, displayName: block.name, mediaType: block.mediaType, byteLength: null, disposition: null, state: ConversationAssetPresentationStates.Unavailable, detail: "File unavailable", canRetry: false, canRemove: false, uploadProgressPercent: null, contentState: ConversationAssetContentCommandStates.Idle, contentDetail: null };
}

/** Translate a server-attested tool lifecycle fact without exposing arguments, results or coordinates. */
export function _ConversationToolStatus(entry: ToolCallLogEntry): ConversationStatusPresentation
{
	switch (entry.phase)
	{
		case "requested": return { label: "Tool requested", detail: `${entry.toolName}: preparing to start.`, tone: ConversationStatusTones.Neutral };
		case "running": return { label: "Tool running", detail: `${entry.toolName}: waiting for a result.`, tone: ConversationStatusTones.Neutral };
		case "completed": return { label: "Tool result received", detail: `${entry.toolName}: result received. The assistant may still be preparing its answer.`, tone: ConversationStatusTones.Neutral };
		case "failed": return { label: "Tool could not finish", detail: `${entry.toolName}: no usable result was received.`, tone: ConversationStatusTones.Danger };
		case "cancelled": return { label: "Tool stopped", detail: `${entry.toolName}: ended without a result.`, tone: ConversationStatusTones.Danger };
		case "recovery_required": return { label: "Tool needs attention", detail: `${entry.toolName}: the outcome is uncertain. OpenCrane will not repeat it automatically.`, tone: ConversationStatusTones.Attention };
		default: return _UnsupportedToolPhase(entry.phase);
	}
}

/** Reject a phase that escaped the shared history validator instead of rendering an empty status. */
function _UnsupportedToolPhase(phase: never): never { throw new Error(`Unsupported tool-call phase: ${String(phase)}`); }

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
