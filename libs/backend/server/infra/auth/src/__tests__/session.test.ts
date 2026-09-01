import { describe, expect, it } from "vitest";

import { _sanitizeReturnTo } from "../session";

describe("session return path", function _Suite()
{
	it("keeps ordinary local paths", function _KeepsLocalPath()
	{
		expect(_sanitizeReturnTo("/onboarding?step=profile#name")).toBe("/onboarding?step=profile#name");
	});

	it.each([
		undefined,
		"https://attacker.example/collect",
		"//attacker.example/collect",
		"/\\attacker.example/collect",
		"/safe\t/../../attacker",
		"/safe\n/../../attacker",
	])("replaces browser-normalized redirect input with the root path", function _RejectsUnsafePath(returnTo)
	{
		expect(_sanitizeReturnTo(returnTo)).toBe("/");
	});
});
