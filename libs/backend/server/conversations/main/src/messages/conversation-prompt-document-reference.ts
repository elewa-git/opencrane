import { ConversationAuthorKinds, ConversationEntryKinds, ConversationMessageContentBlockKinds, type ConversationEntry, type MessageEntry } from "@opencrane/contracts";

import type { ConversationPromptDocumentReference } from "./conversation-prompt-document.types";

/** Select the exact ordered message set and collect only human-authored PDF blocks. */
export function _CollectConversationPromptDocumentReferences(entries: readonly ConversationEntry[], orderedMessageIds: readonly string[]): readonly ConversationPromptDocumentReference[]
{
	if (orderedMessageIds.length === 0 || new Set(orderedMessageIds).size !== orderedMessageIds.length)
		throw new Error("Conversation prompt document preparation requires unique ordered messages");
	const messages = entries.filter(function _CompletedMessage(entry): entry is MessageEntry { return entry.kind === ConversationEntryKinds.Message && entry.state === "completed"; });
	const byId = new Map(messages.map(message => [message.id, message]));
	if (byId.size !== messages.length)
		throw new Error("Conversation prompt history repeats a message identifier");
	const exact = orderedMessageIds.map(messageId => byId.get(messageId));
	if (exact.some(message => message === undefined))
		throw new Error("Conversation prompt document message is absent from canonical history");
	const references: ConversationPromptDocumentReference[] = [];
	for (const message of exact as readonly MessageEntry[])
	{
		for (const block of message.blocks)
		{
			if (block.kind !== ConversationMessageContentBlockKinds.Artifact || block.mediaType !== "application/pdf")
				continue;
			if (message.author.kind !== ConversationAuthorKinds.Human)
				throw new Error("Conversation prompt PDF must belong to a human message");
			references.push({ messageId: message.id, blockId: block.id, sourceArtifactId: block.artifactId, sourceRevisionId: block.artifactRevisionId, name: block.name, mediaType: block.mediaType });
		}
	}
	return references;
}
