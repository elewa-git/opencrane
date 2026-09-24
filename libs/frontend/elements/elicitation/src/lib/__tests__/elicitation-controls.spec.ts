// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ElicitationApprovalScopes } from "@opencrane/contracts";

import { ElicitationApprovalComponent } from "../elicitation-approval.component";

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("ElicitationApprovalComponent", function _ApprovalSuite()
{
	it("emits an approval draft without submitting or advancing authority", function _DraftOnly()
	{
		const component = TestBed.runInInjectionContext(function _Construct() { return new ElicitationApprovalComponent(); });
		let emitted: unknown = null;
		component.valueChange.subscribe(function _Capture(value) { emitted = value; });
		component.allow(ElicitationApprovalScopes.Once);
		expect(emitted).toEqual({ approved: true, scope: ElicitationApprovalScopes.Once });
	});

	it("carries the chosen scope on the draft, so allowing every time is one click", function _ScopedDraft()
	{
		const component = TestBed.runInInjectionContext(function _Construct() { return new ElicitationApprovalComponent(); });
		let emitted: unknown = null;
		component.valueChange.subscribe(function _Capture(value) { emitted = value; });
		component.allow(ElicitationApprovalScopes.Always);
		expect(emitted).toEqual({ approved: true, scope: ElicitationApprovalScopes.Always });
	});

	it("denies at one-off scope however the question was scoped", function _DenialIsOnce()
	{
		const component = TestBed.runInInjectionContext(function _Construct() { return new ElicitationApprovalComponent(); });
		let emitted: unknown = null;
		component.valueChange.subscribe(function _Capture(value) { emitted = value; });
		component.deny();
		expect(emitted).toEqual({ approved: false, scope: ElicitationApprovalScopes.Once });
	});
});
