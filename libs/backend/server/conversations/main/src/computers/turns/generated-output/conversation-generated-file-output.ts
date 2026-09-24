import { ConversationEntryKinds, ConversationMessageContentBlockKinds, type ArtifactMessageContentBlock, type MessageContentBlock, type TextMessageContentBlock } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationGeneratedFileResultStates, type ConversationGeneratedFileContinuation } from "../../tools/results/conversation-generated-file-result.types";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

/** Add only the Artifact selected by the file owner's current Ready decision. */
export function _ConversationComputerAnswerBlocks(text: TextMessageContentBlock, file?: ConversationGeneratedFileContinuation): MessageContentBlock[]
{
	if (file?.state === ConversationGeneratedFileResultStates.Ready)
		return [text, file.artifact];
	return [text];
}

/** Refuse a changed publication decision between output preparation and the atomic history write. */
export function _AssertSameConversationGeneratedFile(expected?: ConversationGeneratedFileContinuation, actual?: ConversationGeneratedFileContinuation): void
{
	if (___DigestCanonicalJson((expected ?? null) as unknown as JsonValue) !== ___DigestCanonicalJson((actual ?? null) as unknown as JsonValue))
		throw new Error("Conversation generated file changed before answer append");
}

/**
 * Read the attachment from a saved answer while enforcing the turn's closed output shape.
 * The file linker uses this after reloading the real turn. This checks shape and reservation only;
 * the file owner must still verify the exact invocation, published revision and requester access.
 * @throws Error if a saved answer has extra blocks or attaches a file outside the final tool call.
 */
export function __ReadConversationGeneratedFileOutput(turn: FrozenConversationComputerTurn): ArtifactMessageContentBlock | null
{
	const entry = turn.outputReceipt?.event.data.entry;
	if (entry?.kind !== ConversationEntryKinds.Message || entry.blocks[0]?.kind !== ConversationMessageContentBlockKinds.Text)
		throw new Error("Conversation computer output requires a text answer");
	if (entry.blocks.length === 1)
		return null;
	const artifact = entry.blocks[1];
	if (entry.blocks.length !== 2 || artifact.kind !== ConversationMessageContentBlockKinds.Artifact
		|| turn.toolSelection === null || turn.continuationReservation?.ordinal !== 2
		|| artifact.id === entry.blocks[0].id)
		throw new Error("Conversation computer output has an invalid generated file");
	return artifact;
}
