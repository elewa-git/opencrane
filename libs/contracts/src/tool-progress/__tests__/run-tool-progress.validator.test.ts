import { describe, expect, it } from "vitest";

import { RunToolProgressPhases } from "../run-tool-progress.types";
import { ___RunToolProgressSchema } from "../run-tool-progress.validator";

describe("public run tool progress contract", function _Suite()
{
	it.each(Object.values(RunToolProgressPhases))("accepts only the phase for %s", function _Known(phase)
	{
		expect(___RunToolProgressSchema.parse({ phase })).toEqual({ phase });
	});

	it.each([{}, null, { phase: "completed" }, { phase: "running", name: "private tool" }, { phase: "running", arguments: { secret: "private" } }, { phase: "result_received", result: "private answer" }, { phase: "needs_attention", invocationId: "private-id" }])("rejects malformed or expanded progress %j", function _Refuses(value)
	{
		expect(___RunToolProgressSchema.safeParse(value).success).toBe(false);
	});
});
