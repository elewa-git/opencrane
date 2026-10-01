import { describe, expect, it, vi } from "vitest";

import { VerifiedConversationPromptMessageRepository } from "../conversation-prompt-message-repository";

describe("VerifiedConversationPromptMessageRepository", function _Suite()
{
	it("returns decrypted canonical messages only when the source preserves the exact snapshot order", async function _LoadsExactOrder()
	{
		const source = { load: vi.fn().mockResolvedValue([{ messageId: "message-1", message: { role: "user", content: "Hello" } }, { messageId: "message-2", message: { role: "assistant", content: "Hi" } }]) };
		const repository = new VerifiedConversationPromptMessageRepository(source);

		await expect(repository.loadMessages(["message-1", "message-2"])).resolves.toEqual([{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }]);
	});

	it("rejects a missing, reordered, or repeated message instead of compiling partial context", async function _RejectsInexactSet()
	{
		const source = { load: vi.fn().mockResolvedValue([{ messageId: "message-2", message: { role: "assistant", content: "Hi" } }]) };
		const repository = new VerifiedConversationPromptMessageRepository(source);

		await expect(repository.loadMessages(["message-1", "message-2"])).rejects.toThrow("exact ordered snapshot set");
		await expect(repository.loadMessages(["message-1", "message-1"])).rejects.toThrow("unique and non-empty");
	});
});
