import { describe, expect, it } from "vitest";

import { _CreateConversationRunAdmission } from "../run-admission-composition";

describe("conversation run admission composition", function _ConversationRunAdmissionCompositionSuite()
{
	it("rejects an invalid process capacity before constructing usable admission", function _RejectInvalidCapacity()
	{
		expect(function _ComposeWithoutActiveCapacity()
		{
			_CreateConversationRunAdmission({} as never, {} as never, {} as never, {} as never, { maxConcurrentAdmissions: 0, maxQueuedAdmissions: 1 });
		}).toThrow(/maxConcurrentAdmissions must be a positive integer/);
	});
});
