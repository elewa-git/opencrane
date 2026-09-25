import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { _CreateReportingFixture, _ReportingButton, _SetReportingInput } from "../../../reporting/__tests__/reporting-component.fixture";
import { GovernanceReadStates } from "../../../reporting/reporting-view.types";
import { TokenUsageSummaryComponent } from "../token-usage-summary.component";

beforeAll(function _init() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _reset() { TestBed.resetTestingModule(); });
afterAll(function _destroy() { TestBed.resetTestEnvironment(); });

/** Mounts returned zero and unknown values without a client-computed aggregate. */
function _fixture(state = GovernanceReadStates.Ready)
{
	const fixture = _CreateReportingFixture(TokenUsageSummaryComponent, "usage/token-usage-summary/token-usage-summary.component.html");
	_SetReportingInput(fixture.componentInstance.feedback, { state, error: null });
	_SetReportingInput(fixture.componentInstance.rows, [
		{ id: "usd", userId: "private-account", currency: "USD", inputTokens: "0", outputTokens: null, totalTokens: null, totalCost: null, budgetCeiling: null },
		{ id: "kes", userId: "another-account", currency: "KES", inputTokens: "50", outputTokens: "10", totalTokens: "60", totalCost: "12.50", budgetCeiling: "100.00" }
	]);
	fixture.detectChanges();
	return fixture;
}

describe("recorded usage", function _recordedUsage()
{
	it("keeps returned currencies separate and unknown values distinct from zero", function _unknown()
	{
		const fixture = _fixture();
		const rows = fixture.nativeElement.querySelectorAll("tbody tr");
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain("USD");
		expect(rows[0].querySelectorAll("td")[2].textContent.trim()).toBe("0");
		expect(rows[0].querySelectorAll("td")[5].textContent.trim()).toBe("Unknown");
		expect(rows[1].textContent).toContain("KES");
		expect(fixture.nativeElement.textContent).toContain("not a live or complete spending report");
		expect(fixture.nativeElement.querySelectorAll("tfoot")).toHaveLength(0);
		const scroller = fixture.nativeElement.querySelector(".p-datatable-table-container");
		expect(scroller.tabIndex).toBe(0);
		expect(scroller.getAttribute("aria-label")).toBe("Recorded usage by account and currency");
	});

	it.each([GovernanceReadStates.Loading, GovernanceReadStates.Unavailable, GovernanceReadStates.Forbidden, GovernanceReadStates.Unauthenticated])("suppresses returned rows in %s", function _hidden(state)
	{
		const fixture = _fixture(state);
		expect(fixture.nativeElement.querySelector("table")).toBeNull();
		expect(fixture.nativeElement.textContent).not.toContain("private-account");
	});

	it("does not describe an empty response as zero spending", function _empty()
	{
		const fixture = _fixture();
		_SetReportingInput(fixture.componentInstance.rows, []);
		fixture.detectChanges();
		expect(fixture.nativeElement.textContent).toContain("does not prove zero usage");
	});

	it("labels retained results and emits only a read retry", function _retained()
	{
		const fixture = _fixture(GovernanceReadStates.RetainedError);
		const refresh = vi.fn();
		fixture.componentInstance.refreshRequested.subscribe(refresh);
		expect(fixture.nativeElement.textContent).toContain("may be out of date");
		expect(fixture.nativeElement.textContent).toContain("private-account");
		_ReportingButton(fixture.nativeElement, "Try again").click();
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("keeps retained rows while a refresh is pending", function _pending()
	{
		const fixture = _fixture(GovernanceReadStates.Refreshing);
		expect(fixture.nativeElement.querySelector("table")).not.toBeNull();
		expect(_ReportingButton(fixture.nativeElement, "Refresh recorded usage").disabled).toBe(true);
	});
});
