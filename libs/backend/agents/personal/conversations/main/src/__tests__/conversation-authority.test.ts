import { describe, expect, it, vi } from "vitest";

import { __AppendRunEvent } from "../conversation-authority.js";
import type { ConversationAuthorityRepository } from "../conversation-authority.types.js";

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
});
