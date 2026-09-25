import { describe, expect, it } from "vitest";

import { _PendingQuestionLabel } from "../conversation-pending-question.mapper";

describe("pending question count presentation", function _Suite()
{
	it("keeps singular and plural action names aligned", function _Grammar()
	{
		expect(_PendingQuestionLabel(1)).toBe("1 question needs your response");
		expect(_PendingQuestionLabel(2)).toBe("2 questions need your response");
	});
});
