import { describe, expect, it } from "vitest";
import { _ParseGroupChildCreate, _ParseGroupChildShare } from "../group-child.validator";

const _UUID = "772340d2-5718-40c4-bca9-24d47d63ba9b";

describe("group child command boundaries", function ()
{
	it("binds an exact non-genesis message and rejects browser-supplied authority or audience", function ()
	{
		const command = { parentMessageId: _UUID, parentMessagePosition: "1", agentServiceId: "assistant-1", idempotencyKey: _UUID };
		expect(_ParseGroupChildCreate(command)).toEqual(command);
		for (const extra of [{ principalId: "admin" }, { participantIds: ["peer"] }, { siloId: "foreign" }])
			expect(_ParseGroupChildCreate({ ...command, ...extra })).toBeNull();
		for (const position of ["0", "01", "-1", "18446744073709551615", "1,2"])
			expect(_ParseGroupChildCreate({ ...command, parentMessagePosition: position })).toBeNull();
	});

	it("preserves the exact reviewed text and bounds encoded bytes", function ()
	{
		const command = { sourceEntryId: _UUID, sourcePosition: "3", text: "  Reviewed result\n", idempotencyKey: _UUID };
		expect(_ParseGroupChildShare(command)).toEqual(command);
		expect(_ParseGroupChildShare({ ...command, text: "😀".repeat(16_385) })).toBeNull();
		expect(_ParseGroupChildShare({ ...command, text: "  " })).toBeNull();
		expect(_ParseGroupChildShare({ ...command, parentConversationId: "foreign" })).toBeNull();
	});
});
