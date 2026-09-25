import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { _CreateReportingFixture, _ReportingButton, _SetReportingInput } from "../../../reporting/__tests__/reporting-component.fixture";
import { GovernanceReadStates } from "../../../reporting/reporting-view.types";
import { AuditResultsComponent } from "../audit-results.component";

beforeAll(function _init() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _reset() { TestBed.resetTestingModule(); });
afterAll(function _destroy() { TestBed.resetTestEnvironment(); });

/** Mounts a supplied state with a deliberately hostile returned message. */
function _fixture(state = GovernanceReadStates.Ready)
{
	const fixture = _CreateReportingFixture(AuditResultsComponent, "audit/audit-results/audit-results.component.html");
	_SetReportingInput(fixture.componentInstance.feedback, { state, error: null });
	_SetReportingInput(fixture.componentInstance.rows, [{ id: "event-1", timestamp: "22 Sep 2026, 10:00 UTC", action: "run.read", resource: "private-resource", message: "<img src=x onerror=alert(1)>" }]);
	fixture.detectChanges();
	return fixture;
}

describe("audit results", function _auditResults()
{
	it("renders escaped returned values with semantic column headers", function _escaped()
	{
		const fixture = _fixture();
		expect(fixture.nativeElement.textContent).toContain("<img src=x onerror=alert(1)>");
		expect(fixture.nativeElement.querySelector("img")).toBeNull();
		expect(fixture.nativeElement.querySelectorAll("th[scope='col']")).toHaveLength(4);
		const scroller = fixture.nativeElement.querySelector(".p-datatable-table-container");
		expect(scroller.tabIndex).toBe(0);
		expect(scroller.getAttribute("aria-label")).toBe("Visible audit entries");
	});

	it.each([GovernanceReadStates.Loading, GovernanceReadStates.Unavailable, GovernanceReadStates.Forbidden, GovernanceReadStates.Unauthenticated])("hides supplied rows in %s", function _hidden(state)
	{
		const fixture = _fixture(state);
		expect(fixture.nativeElement.querySelector("table")).toBeNull();
		expect(fixture.nativeElement.textContent).not.toContain("private-resource");
	});

	it("preserves stale rows with an explicit warning and read retry", function _retained()
	{
		const fixture = _fixture(GovernanceReadStates.RetainedError);
		expect(fixture.nativeElement.textContent).toContain("may be out of date");
		expect(fixture.nativeElement.textContent).toContain("private-resource");
		const refresh = vi.fn();
		fixture.componentInstance.refreshRequested.subscribe(refresh);
		_ReportingButton(fixture.nativeElement, "Try again").click();
		expect(refresh).toHaveBeenCalledOnce();
	});

	it("offers continuation for an empty filtered page", function _emptyPage()
	{
		const fixture = _fixture();
		_SetReportingInput(fixture.componentInstance.rows, []);
		_SetReportingInput(fixture.componentInstance.hasMore, true);
		fixture.detectChanges();
		const more = vi.fn();
		fixture.componentInstance.loadMoreRequested.subscribe(more);
		expect(fixture.nativeElement.textContent).toContain("hidden by permissions");
		_ReportingButton(fixture.nativeElement, "Load more audit entries").click();
		expect(more).toHaveBeenCalledOnce();
	});

	it("blocks duplicate controls during continuation and suppresses stale continuation after denial", function _continuation()
	{
		const fixture = _fixture();
		_SetReportingInput(fixture.componentInstance.hasMore, true);
		_SetReportingInput(fixture.componentInstance.loadingMore, true);
		fixture.detectChanges();
		expect(_ReportingButton(fixture.nativeElement, "Load more audit entries").disabled).toBe(true);
		expect(_ReportingButton(fixture.nativeElement, "Refresh audit").disabled).toBe(true);
		_SetReportingInput(fixture.componentInstance.feedback, { state: GovernanceReadStates.Forbidden, error: "old-private-error" });
		_SetReportingInput(fixture.componentInstance.loadMoreError, "private-continuation-error");
		fixture.detectChanges();
		expect(fixture.nativeElement.textContent).not.toContain("Load more audit entries");
		expect(fixture.nativeElement.textContent).not.toContain("private");
	});

	it("retains rows while refresh is pending and disables refresh", function _refreshing()
	{
		const fixture = _fixture(GovernanceReadStates.Refreshing);
		expect(fixture.nativeElement.textContent).toContain("private-resource");
		expect(_ReportingButton(fixture.nativeElement, "Refresh audit").disabled).toBe(true);
	});
});
