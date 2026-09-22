import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { _CreateReportingFixture, _ReportingButton, _SetReportingInput } from "../../../reporting/__tests__/reporting-component.fixture";
import { GovernanceReadStates } from "../../../reporting/reporting-view.types";
import { BudgetSummaryComponent } from "../budget-summary.component";

beforeAll(function _init() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _reset() { TestBed.resetTestingModule(); });
afterAll(function _destroy() { TestBed.resetTestEnvironment(); });

/** Mounts independently selected read states with private stale values for suppression checks. */
function _fixture(globalState = GovernanceReadStates.Ready, accountsState = GovernanceReadStates.Ready)
{
	const fixture = _CreateReportingFixture(BudgetSummaryComponent, "usage/budget-summary/budget-summary.component.html");
	_SetReportingInput(fixture.componentInstance.globalFeedback, { state: globalState, error: null });
	_SetReportingInput(fixture.componentInstance.accountsFeedback, { state: accountsState, error: null });
	_SetReportingInput(fixture.componentInstance.globalBudget, "USD 0");
	_SetReportingInput(fixture.componentInstance.overrides, [{ id: "override", userId: "private-account", budget: "KES 5,000" }]);
	fixture.detectChanges();
	return fixture;
}

describe("returned budgets", function _returnedBudgets()
{
	it("discloses the ambiguous default without claiming enforced configuration", function _default()
	{
		const fixture = _fixture();
		expect(fixture.nativeElement.querySelector("dd").textContent.trim()).toBe("USD 0");
		expect(fixture.nativeElement.textContent).toContain("cannot distinguish a default from a deliberately configured zero");
		const scroller = fixture.nativeElement.querySelector(".p-datatable-table-container");
		expect(scroller.tabIndex).toBe(0);
		expect(scroller.getAttribute("aria-label")).toBe("Account budget rows");
	});

	it("keeps account overrides visible when global access is denied", function _globalDenied()
	{
		const fixture = _fixture(GovernanceReadStates.Forbidden);
		expect(fixture.nativeElement.querySelector("dd")).toBeNull();
		expect(fixture.nativeElement.textContent).toContain("private-account");
	});

	it("keeps the global value visible when account access is denied", function _accountsDenied()
	{
		const fixture = _fixture(GovernanceReadStates.Ready, GovernanceReadStates.Forbidden);
		expect(fixture.nativeElement.querySelector("dd").textContent).toContain("USD 0");
		expect(fixture.nativeElement.textContent).not.toContain("private-account");
	});

	it("clears both values after session loss and explains sign-in recovery", function _sessionLost()
	{
		const fixture = _fixture(GovernanceReadStates.Unauthenticated, GovernanceReadStates.Unauthenticated);
		expect(fixture.nativeElement.querySelector("dd")).toBeNull();
		expect(fixture.nativeElement.querySelector("table")).toBeNull();
		expect(fixture.nativeElement.textContent).not.toContain("private-account");
		expect(fixture.nativeElement.textContent).toContain("Sign in again");
	});

	it("emits independent refresh intents", function _refresh()
	{
		const fixture = _fixture();
		const global = vi.fn();
		const accounts = vi.fn();
		fixture.componentInstance.globalRefreshRequested.subscribe(global);
		fixture.componentInstance.accountRefreshRequested.subscribe(accounts);
		_ReportingButton(fixture.nativeElement, "Refresh global budget").click();
		expect(global).toHaveBeenCalledOnce();
		expect(accounts).not.toHaveBeenCalled();
		_ReportingButton(fixture.nativeElement, "Refresh account budgets").click();
		expect(accounts).toHaveBeenCalledOnce();
	});

	it("does not let a pending global read disable account refresh", function _independentPending()
	{
		const fixture = _fixture(GovernanceReadStates.Refreshing, GovernanceReadStates.Ready);
		expect(_ReportingButton(fixture.nativeElement, "Refresh global budget").disabled).toBe(true);
		expect(_ReportingButton(fixture.nativeElement, "Refresh account budgets").disabled).toBe(false);
	});

	it("renders null amounts as unknown and empty overrides without inventing account limits", function _unknown()
	{
		const fixture = _fixture();
		_SetReportingInput(fixture.componentInstance.globalBudget, null);
		_SetReportingInput(fixture.componentInstance.overrides, []);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector("dd").textContent.trim()).toBe("Unknown");
		expect(fixture.nativeElement.textContent).toContain("No account overrides are available");
	});

	it("separates initial failure from retained account data", function _independentFailure()
	{
		const fixture = _fixture(GovernanceReadStates.Unavailable, GovernanceReadStates.RetainedError);
		expect(fixture.nativeElement.querySelector("dd")).toBeNull();
		expect(fixture.nativeElement.textContent).toContain("may be out of date");
		expect(fixture.nativeElement.textContent).toContain("private-account");
	});
});
