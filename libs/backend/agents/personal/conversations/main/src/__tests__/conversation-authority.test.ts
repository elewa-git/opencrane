import { describe, expect, it, vi } from "vitest";

import { __AppendRunEvent } from "../conversation-authority.js";
import { __SubmitConversationUserInput } from "../conversation-user-input.js";
import type { ConversationAuthorityRepository, ConversationUserInputRepository } from "../conversation-authority.types.js";

describe("conversation authority", function ()
{
	it("keeps sequence fencing inside one atomic repository append", async function ()
	{
		const appendRunEventAtomically = vi.fn().mockResolvedValue({ status: "sequence_conflict", nextSequence: 3 });
		const repository: ConversationAuthorityRepository = { appendRunEventAtomically };
		const result = await __AppendRunEvent(repository, { runId: "run-1", sequence: 2, type: "message.delta", payload: { text: "hello" }, occurredAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "sequence_conflict", nextSequence: 3 });
		expect(appendRunEventAtomically).toHaveBeenCalledOnce();
	});

	it("rejects malformed sequence without reaching persistence", async function ()
	{
		const appendRunEventAtomically = vi.fn();
		const result = await __AppendRunEvent({ appendRunEventAtomically }, { runId: "run-1", sequence: 0, type: "run.started", payload: {}, occurredAt: "2026-07-18T09:00:00.000Z" });
		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(appendRunEventAtomically).not.toHaveBeenCalled();
	});

	it("submits text and ordered artifact revisions through one atomic repository call", async function _submitsAtomicInput()
	{
		const submitAtomically = vi.fn().mockResolvedValue({ status: "submitted" });
		const repository: ConversationUserInputRepository = { submitAtomically };
		const command = { messageId: "message-1", siloId: "silo-1", threadId: "thread-1", userId: "user-1", text: "Please inspect this image", artifactRevisionIds: ["revision-1", "revision-2"] } as const;

		expect(await __SubmitConversationUserInput(repository, command)).toEqual({ outcome: "submitted" });
		expect(submitAtomically).toHaveBeenCalledWith(command);
	});

	it("rejects an empty user input before persistence", async function _rejectsEmptyInput()
	{
		const submitAtomically = vi.fn();

		await expect(__SubmitConversationUserInput({ submitAtomically }, { messageId: "message-1", siloId: "silo-1", threadId: "thread-1", userId: "user-1", text: "", artifactRevisionIds: [] })).resolves.toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(submitAtomically).not.toHaveBeenCalled();
	});

});
