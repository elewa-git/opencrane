import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { GovernanceReadError, GovernanceReadErrorKinds, type GovernanceAuditPage } from "@opencrane/state/governance";

import { _DeferredGovernanceRead, _GovernanceAuditPage, _GovernanceStoreFixture, _WaitForGovernanceRead } from "../../reporting/__tests__/governance-store.fixture";
import { GovernanceReadStates } from "../../reporting/reporting-view.types";
import { AuditStore } from "../audit.store";

beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _Reset() { TestBed.resetTestingModule(); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });

describe("audit store traversal", function _Traversal()
{
	it("starts loading and adopts a terminal first page without offering more work", async function _InitialLoad()
	{
		const fixture = _GovernanceStoreFixture();
		const first = _DeferredGovernanceRead<GovernanceAuditPage>();
		fixture.gateway.readAuditPage.mockReturnValueOnce(first.promise);
		const store = TestBed.inject(AuditStore);
		TestBed.tick();
		expect(store.snapshot.feedback().state).toBe(GovernanceReadStates.Loading);
		store.loadMore(); store.refresh();
		expect(fixture.gateway.readAuditPage).toHaveBeenCalledTimes(1);
		first.resolve(_GovernanceAuditPage(["first"]));
		await _WaitForGovernanceRead(function _Loaded() { expect(store.snapshot.value()).toEqual(_GovernanceAuditPage(["first"])); expect(store.snapshot.busy()).toBe(false); });
		store.loadMore();
		TestBed.tick();
		expect(fixture.gateway.readAuditPage).toHaveBeenCalledTimes(1);
	});

	it("advances through a filtered empty page using the returned cursor", async function _FilteredEmptyPage()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readAuditPage.mockResolvedValueOnce(_GovernanceAuditPage(["first"], "cursor-1")).mockResolvedValueOnce(_GovernanceAuditPage([], "cursor-2")).mockResolvedValueOnce(_GovernanceAuditPage(["last"]));
		const store = TestBed.inject(AuditStore);
		await _WaitForGovernanceRead(function _First() { expect(store.snapshot.value()?.pagination.nextCursor).toBe("cursor-1"); expect(store.snapshot.busy()).toBe(false); });
		store.loadMore();
		await _WaitForGovernanceRead(function _HiddenPage()
		{
			expect(store.snapshot.value()?.pagination.nextCursor).toBe("cursor-2");
			expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["first"]);
			expect(store.snapshot.busy()).toBe(false);
		});
		store.loadMore();
		await _WaitForGovernanceRead(function _Last() { expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["first", "last"]); expect(store.snapshot.value()?.pagination.hasMore).toBe(false); });
		expect(fixture.gateway.readAuditPage.mock.calls.map(call => call[0])).toEqual([{}, { cursor: "cursor-1" }, { cursor: "cursor-2" }]);
	});

	it("retries a failed page at the same cursor and appends its rows only once", async function _PageRetry()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readAuditPage.mockResolvedValueOnce(_GovernanceAuditPage(["first"], "cursor-1")).mockRejectedValueOnce(new GovernanceReadError(GovernanceReadErrorKinds.Unavailable)).mockResolvedValueOnce(_GovernanceAuditPage(["second"]));
		const store = TestBed.inject(AuditStore);
		await _WaitForGovernanceRead(function _First() { expect(store.snapshot.value()?.pagination.nextCursor).toBe("cursor-1"); expect(store.snapshot.busy()).toBe(false); });
		store.loadMore();
		await _WaitForGovernanceRead(function _Failed()
		{
			expect(store.snapshot.feedback().state).toBe(GovernanceReadStates.RetainedError);
			expect(store.loadMoreError()).toContain("out of date");
			expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["first"]);
			expect(store.snapshot.value()?.pagination.nextCursor).toBe("cursor-1");
		});
		store.loadMore(); store.loadMore();
		await _WaitForGovernanceRead(function _Retried() { expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["first", "second"]); expect(store.snapshot.busy()).toBe(false); });
		expect(fixture.gateway.readAuditPage.mock.calls.map(call => call[0])).toEqual([{}, { cursor: "cursor-1" }, { cursor: "cursor-1" }]);
		expect(store.loadMoreError()).toBeNull();
	});

	it("closes duplicate load-more admission before the resource starts, then refresh replaces traversal", async function _AdmissionAndRefresh()
	{
		const fixture = _GovernanceStoreFixture();
		const older = _DeferredGovernanceRead<GovernanceAuditPage>();
		fixture.gateway.readAuditPage.mockResolvedValueOnce(_GovernanceAuditPage(["first"], "cursor-1")).mockReturnValueOnce(older.promise).mockResolvedValueOnce(_GovernanceAuditPage(["fresh"], "fresh-cursor"));
		const store = TestBed.inject(AuditStore);
		await _WaitForGovernanceRead(function _First() { expect(store.snapshot.busy()).toBe(false); expect(store.snapshot.value()?.data).toHaveLength(1); });
		store.loadMore(); store.loadMore(); store.refresh();
		expect(store.loadingMore()).toBe(true);
		TestBed.tick();
		expect(fixture.gateway.readAuditPage).toHaveBeenCalledTimes(2);
		older.resolve(_GovernanceAuditPage(["older"], "cursor-2"));
		await _WaitForGovernanceRead(function _Older() { expect(store.snapshot.busy()).toBe(false); expect(store.snapshot.value()?.data).toHaveLength(2); });
		store.refresh(); store.refresh(); store.loadMore();
		expect(store.loadingMore()).toBe(false);
		await _WaitForGovernanceRead(function _Fresh() { expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["fresh"]); expect(store.snapshot.value()?.pagination.nextCursor).toBe("fresh-cursor"); });
		expect(fixture.gateway.readAuditPage.mock.calls.map(call => call[0])).toEqual([{}, { cursor: "cursor-1" }, {}]);
	});

	it("retains old traversal on refresh failure and retries from the first page", async function _RefreshFailure()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readAuditPage.mockResolvedValueOnce(_GovernanceAuditPage(["old"], "old-cursor")).mockRejectedValueOnce(new GovernanceReadError(GovernanceReadErrorKinds.InvalidResponse)).mockResolvedValueOnce(_GovernanceAuditPage(["new"]));
		const store = TestBed.inject(AuditStore);
		await _WaitForGovernanceRead(function _Old() { expect(store.snapshot.busy()).toBe(false); expect(store.snapshot.value()?.data).toHaveLength(1); });
		store.refresh();
		await _WaitForGovernanceRead(function _Retained() { expect(store.snapshot.feedback().state).toBe(GovernanceReadStates.RetainedError); expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["old"]); });
		expect(store.loadMoreError()).toBeNull();
		store.refresh();
		await _WaitForGovernanceRead(function _New() { expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["new"]); });
		expect(fixture.gateway.readAuditPage.mock.calls.map(call => call[0])).toEqual([{}, {}, {}]);
	});

	it("clears retained history after a page read is denied", async function _ForbiddenPage()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readAuditPage.mockResolvedValueOnce(_GovernanceAuditPage(["private"], "cursor-1")).mockRejectedValueOnce(new GovernanceReadError(GovernanceReadErrorKinds.AccessDenied));
		const store = TestBed.inject(AuditStore);
		await _WaitForGovernanceRead(function _First() { expect(store.snapshot.busy()).toBe(false); expect(store.snapshot.value()?.data).toHaveLength(1); });
		store.loadMore();
		await _WaitForGovernanceRead(function _Denied() { expect(store.snapshot.feedback().state).toBe(GovernanceReadStates.Forbidden); expect(store.snapshot.value()).toBeNull(); });
		store.loadMore();
		TestBed.tick();
		expect(fixture.gateway.readAuditPage).toHaveBeenCalledTimes(2);
	});

	it("restarts audit at the first page when the authenticated reader changes", async function _ReaderTraversalReset()
	{
		const fixture = _GovernanceStoreFixture();
		const readerB = _DeferredGovernanceRead<GovernanceAuditPage>();
		fixture.gateway.readAuditPage.mockResolvedValueOnce(_GovernanceAuditPage(["a-first"], "a-cursor")).mockResolvedValueOnce(_GovernanceAuditPage(["a-older"], "a-next")).mockReturnValueOnce(readerB.promise);
		const store = TestBed.inject(AuditStore);
		await _WaitForGovernanceRead(function _First() { expect(store.snapshot.busy()).toBe(false); expect(store.snapshot.value()?.data).toHaveLength(1); });
		store.loadMore();
		await _WaitForGovernanceRead(function _Older() { expect(store.snapshot.busy()).toBe(false); expect(store.snapshot.value()?.data).toHaveLength(2); });
		fixture.reader.set("reader-b");
		expect(store.snapshot.value()).toBeNull();
		TestBed.tick();
		expect(store.loadingMore()).toBe(false);
		expect(store.snapshot.feedback().state).toBe(GovernanceReadStates.Loading);
		readerB.resolve(_GovernanceAuditPage(["b-first"]));
		await _WaitForGovernanceRead(function _NewReader() { expect(store.snapshot.value()?.data.map(row => row.message)).toEqual(["b-first"]); expect(store.snapshot.busy()).toBe(false); });
		expect(fixture.gateway.readAuditPage.mock.calls.map(call => call[0])).toEqual([{}, { cursor: "a-cursor" }, {}]);
		expect(store.loadingMore()).toBe(false);
	});
});
