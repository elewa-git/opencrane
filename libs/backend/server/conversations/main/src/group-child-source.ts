import type { MessageEntry } from "@opencrane/contracts";
import type { SelfConversationHistoryAuthority } from "./self-conversation-history.types";
import type { ConversationCaller } from "./types/conversation-caller.types";

/**
 * Reads exactly one currently visible text message, checking the supplied revision against its UUID.
 * The participant history authority rechecks access before plaintext is released. Source positions
 * are caller-selected lookup hints and never replace its membership or immutable entry checks.
 */
export async function _ReadGroupChildSource(history: Pick<SelfConversationHistoryAuthority, "read">, caller: ConversationCaller, conversationId: string, entryId: string, position: bigint): Promise<{ readonly entry: MessageEntry; readonly text: string } | null>
{
	const page = await history.read(caller, conversationId, position - 1n, { maxCount: 1, maximumBytes: 131_072, signal: AbortSignal.timeout(10_000) });
	if (page === null || page.entries.length !== 1)
		return null;
	const entry = page.entries[0]!;
	if (entry.id !== entryId || entry.position !== position.toString() || entry.kind !== "message" || entry.state !== "completed" || entry.blocks.length === 0 || entry.blocks.some(block => block.kind !== "text"))
		return null;
	const texts: string[] = [];
	for (const block of entry.blocks)
	{
		if (block.kind !== "text" || typeof page.payloads[block.payloadRef] !== "string")
			return null;
		texts.push(page.payloads[block.payloadRef]!);
	}
	const text = texts.join("\n");
	return Buffer.byteLength(text, "utf8") <= 65_536 ? { entry, text } : null;
}
