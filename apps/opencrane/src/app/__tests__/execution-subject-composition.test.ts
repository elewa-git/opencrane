import { describe, expect, it } from "vitest";

import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _RequireExecutionSubjectComposition } from "../execution-subject-composition";

/** Proves startup refuses to expose execution routes before their target evidence adapter exists. */
describe("_RequireExecutionSubjectComposition", function _DescribeExecutionSubjectComposition()
{
	/** Refuses the retired request-identity fallback instead of constructing a partial authority. */
	it("fails closed until the app composes the target evidence adapter", function _RejectsPartialComposition()
	{
		expect(function _RejectsWithoutAuthority() { _RequireExecutionSubjectComposition({} as HistoryStore); }).toThrow("requires an app-owned execution-subject adapter");
	});
});
