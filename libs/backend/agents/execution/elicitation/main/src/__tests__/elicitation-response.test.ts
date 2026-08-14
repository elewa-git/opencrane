import { describe, expect, it } from "vitest";

import { ElicitationBodyKinds } from "@opencrane/contracts";

import { _ElicitationStateForResponse, _IsElicitationResponseValid } from "../elicitation-response";

describe("elicitation response validation", function _Suite()
{
	it("admits only an exact known single choice", function _SingleChoice()
	{
		const body = { kind: ElicitationBodyKinds.SingleChoice, prompt: "Choose", choices: [{ value: "one", label: "One" }] } as const;
		expect(_IsElicitationResponseValid(body, { kind: ElicitationBodyKinds.SingleChoice, selection: "one" })).toBe(true);
		expect(_IsElicitationResponseValid(body, { kind: ElicitationBodyKinds.SingleChoice, selection: "two" })).toBe(false);
	});

	it("enforces unique bounded multiple choices", function _MultipleChoice()
	{
		const body = { kind: ElicitationBodyKinds.MultipleChoice, prompt: "Choose", choices: [{ value: "one", label: "One" }, { value: "two", label: "Two" }], minimumSelections: 1, maximumSelections: 2 } as const;
		expect(_IsElicitationResponseValid(body, { kind: ElicitationBodyKinds.MultipleChoice, selections: ["one", "two"] })).toBe(true);
		expect(_IsElicitationResponseValid(body, { kind: ElicitationBodyKinds.MultipleChoice, selections: ["one", "one"] })).toBe(false);
	});

	it("counts Unicode code points and distinguishes denial", function _TextAndDenial()
	{
		const body = { kind: ElicitationBodyKinds.FreeText, prompt: "Answer", maximumLength: 1, allowEmpty: false } as const;
		expect(_IsElicitationResponseValid(body, { kind: ElicitationBodyKinds.FreeText, text: "😀" })).toBe(true);
		expect(_IsElicitationResponseValid(body, { kind: ElicitationBodyKinds.FreeText, text: "  " })).toBe(false);
		expect(_ElicitationStateForResponse({ kind: ElicitationBodyKinds.Approval, approved: false })).toBe("declined");
	});
});
