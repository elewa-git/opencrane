import type { ConversationEntry } from "@opencrane/contracts";
import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";
import type { ConversationGroupSource, ConversationWorkspaceDetail } from "@opencrane/state/conversation/workspace";

/**
 * Selects the person's own completed group message for an explicit company-assistant request.
 * The authenticated session supplies the subject for presentation; the API repeats all authority
 * and source checks before admission. Directory membership IDs must not be used as author subjects.
 */
export function _GroupRequestSource(entry: ConversationEntry, payloads: Readonly<Record<string, string>>, selected: ConversationWorkspaceDetail, subject: string | undefined): ConversationGroupSource | null
{
	if (selected.mode !== ConversationModes.Group || selected.lifecycle !== ConversationLifecycles.Open || selected.accessEndedPosition !== null || entry.conversationId !== selected.id || entry.author.kind !== "human" || subject === undefined || entry.author.participantId !== subject)
		return null;
	return _textSource(entry, payloads);
}

/** Selects a completed assistant response for an edited human share to its immediate group. */
export function _GroupShareSource(entry: ConversationEntry, payloads: Readonly<Record<string, string>>, selected: ConversationWorkspaceDetail): ConversationGroupSource | null
{
	if (selected.parent === null || selected.accessEndedPosition !== null || entry.conversationId !== selected.id || entry.author.kind !== "agent")
		return null;
	return _textSource(entry, payloads);
}

/** Refuses private, partial, missing, or mixed-content sources instead of silently dropping content. */
function _textSource(entry: ConversationEntry, payloads: Readonly<Record<string, string>>): ConversationGroupSource | null
{
	if (entry.kind !== "message" || entry.state !== "completed" || entry.visibility.audience !== "conversation" || entry.blocks.length === 0)
		return null;
	const texts: string[] = [];
	for (const block of entry.blocks)
	{
		if (block.kind !== "text" || typeof payloads[block.payloadRef] !== "string")
			return null;
		texts.push(payloads[block.payloadRef]!);
	}
	const text = texts.join("\n");
	return text.trim() && new TextEncoder().encode(text).byteLength <= 65_536 ? { entryId: entry.id, position: entry.position, text } : null;
}
