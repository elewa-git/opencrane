// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ElicitationApprovalComponent, _ApprovalAvailable } from "../elicitation-approval.component";

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ElicitationApprovalComponent", function _ApprovalSuite()
{
	it("emits an approval draft without submitting or advancing authority", function _DraftOnly()
	{
		const component = TestBed.runInInjectionContext(function _Construct() { return new ElicitationApprovalComponent(); });
		let emitted: unknown = null;
		component.valueChange.subscribe(function _Capture(value) { emitted = value; });
		component.select(false);
		expect(emitted).toBe(false);
	});

	it("keeps denial available when hidden arguments make approval unavailable", function _HiddenArguments()
	{
		const base = { prompt: "Continue?", action: "Send data", target: "Calendar", dataUse: "Meeting details", consequence: "A meeting may be created." };
		expect(_ApprovalAvailable({ ...base, proposedArguments: null }, false)).toBe(false);
		expect(_ApprovalAvailable(base, true)).toBe(false);
		expect(_ApprovalAvailable(base, false)).toBe(true);
	});
});
