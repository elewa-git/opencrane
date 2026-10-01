import type { CompiledMessage } from "@opencrane/contracts";

import type { ConversationPromptMessageRepository, ConversationPromptMessageSource } from "./prompt-compiler.types";

/**
 * Preserves snapshot order across an injected Kurrent and encrypted-payload message source.
 *
 * The source owns history access and decryption. This package owns the final exact-set check, so a
 * missing, duplicate, foreign, or reordered source result cannot silently change model context.
 *
 * Called by: application prompt-compiler composition for personal ConversationComputer runs.
 * @implements ConversationPromptMessageRepository
 * @see ConversationPromptMessageSource for the infrastructure adapter boundary.
 */
export class VerifiedConversationPromptMessageRepository implements ConversationPromptMessageRepository
{
	/** Kurrent and private-payload adapter supplied by the conversation owner. */
	private readonly _source: ConversationPromptMessageSource;

	/** Bind exact-set verification around one canonical conversation message source. */
	constructor(source: ConversationPromptMessageSource)
	{
		this._source = source;
	}

	/** Resolve every requested message exactly once and in snapshot order. */
	async loadMessages(messageIds: readonly string[]): Promise<readonly CompiledMessage[]>
	{
		if (new Set(messageIds).size !== messageIds.length || messageIds.some(function _Blank(messageId): boolean { return messageId.trim().length === 0; }))
			throw new Error("Prompt message identifiers must be unique and non-empty");
		const loaded = await this._source.load(messageIds);
		if (loaded.length !== messageIds.length || loaded.some(function _WrongMessage(entry, index): boolean { return entry.messageId !== messageIds[index]; }))
			throw new Error("Prompt message source did not return the exact ordered snapshot set");
		return loaded.map(entry => entry.message);
	}
}
