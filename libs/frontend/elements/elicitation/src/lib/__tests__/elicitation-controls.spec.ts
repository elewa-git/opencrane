// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ElicitationApprovalComponent } from "../elicitation-approval.component.js";

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ElicitationApprovalComponent", function _ApprovalSuite()
{
	it("emits an approval draft without submitting or advancing authority", function _DraftOnly()
	{
		const component = TestBed.runInInjectionContext(function _Construct() { return new ElicitationApprovalComponent(); });
		let emitted: unknown = null;
		component.valueChange.subscribe(function _Capture(value) { emitted = value; });
		component.select(true);
		expect(emitted).toBe(true);
	});
});
