import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { GovernanceReadError, GovernanceReadErrorKinds, type GovernanceAccountBudgets, type GovernanceBudget, type GovernanceTokenUsageRows } from "@opencrane/state/governance";

import { _DeferredGovernanceRead, _GovernanceStoreFixture, _WaitForGovernanceRead } from "../../reporting/__tests__/governance-store.fixture";
import { GovernanceReadStates } from "../../reporting/reporting-view.types";
import { UsageStore } from "../usage.store";

beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _Reset() { TestBed.resetTestingModule(); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });

/** Distinguishes the reporting projection's reader in delayed-response tests. */
function _Usage(userId = "reader-a"): GovernanceTokenUsageRows
{
	return [{ userId, inputTokens: 2, outputTokens: 3, totalTokens: 5, currency: "USD", totalCost: 0.005 }];
}

describe("usage store independent read lifecycles", function _Lifecycle()
{
	it("loads all three projections independently and adopts successful zero values", async function _LoadingSuccess()
	{
		const fixture = _GovernanceStoreFixture();
		const usage = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		const global = _DeferredGovernanceRead<GovernanceBudget>();
		const accounts = _DeferredGovernanceRead<GovernanceAccountBudgets>();
		fixture.gateway.readTokenUsage.mockReturnValueOnce(usage.promise);
		fixture.gateway.readGlobalBudget.mockReturnValueOnce(global.promise);
		fixture.gateway.readAccountBudgets.mockReturnValueOnce(accounts.promise);
		const store = TestBed.inject(UsageStore);
		TestBed.tick();
		for (const snapshot of [store.usage, store.globalBudget, store.accountBudgets])
		{
			expect(snapshot.feedback().state).toBe(GovernanceReadStates.Loading);
			expect(snapshot.busy()).toBe(true);
			expect(snapshot.value()).toBeNull();
		}
		usage.resolve(_Usage());
		global.resolve({ currency: "USD", ceilingAmount: 0 });
		accounts.resolve([]);
		await _WaitForGovernanceRead(function _Loaded()
		{
			expect(store.usage.feedback().state).toBe(GovernanceReadStates.Ready);
			expect(store.globalBudget.feedback().state).toBe(GovernanceReadStates.Ready);
			expect(store.accountBudgets.feedback().state).toBe(GovernanceReadStates.Ready);
			expect(store.usage.value()).toEqual(_Usage());
			expect(store.globalBudget.value()).toEqual({ currency: "USD", ceilingAmount: 0 });
			expect(store.accountBudgets.value()).toEqual([]);
		});
	});

	it("shows an initial failure and retries only the selected endpoint", async function _InitialFailureRetry()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readTokenUsage.mockRejectedValueOnce(new Error("private transport details")).mockResolvedValueOnce(_Usage());
		const store = TestBed.inject(UsageStore);
		await _WaitForGovernanceRead(function _Failed()
		{
			expect(store.usage.feedback().state).toBe(GovernanceReadStates.Unavailable);
			expect(store.usage.value()).toBeNull();
			expect(store.usage.feedback().error).not.toContain("private");
			expect(store.globalBudget.feedback().state).toBe(GovernanceReadStates.Ready);
		});
		store.refreshUsage();
		await _WaitForGovernanceRead(function _Retried() { expect(store.usage.value()).toEqual(_Usage()); expect(store.usage.busy()).toBe(false); });
		expect(fixture.gateway.readTokenUsage).toHaveBeenCalledTimes(2);
		expect(fixture.gateway.readGlobalBudget).toHaveBeenCalledTimes(1);
		expect(fixture.gateway.readAccountBudgets).toHaveBeenCalledTimes(1);
	});

	it("admits one refresh immediately and retains stale values after its failure", async function _RetainedError()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readTokenUsage.mockResolvedValueOnce(_Usage());
		const store = TestBed.inject(UsageStore);
		await _WaitForGovernanceRead(function _Loaded() { expect(store.usage.value()).toEqual(_Usage()); expect(store.usage.busy()).toBe(false); });
		const refresh = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		fixture.gateway.readTokenUsage.mockReturnValueOnce(refresh.promise);
		store.refreshUsage();
		store.refreshUsage();
		expect(store.usage.feedback().state).toBe(GovernanceReadStates.Refreshing);
		TestBed.tick();
		expect(fixture.gateway.readTokenUsage).toHaveBeenCalledTimes(2);
		expect(store.usage.value()).toEqual(_Usage());
		refresh.reject(new GovernanceReadError(GovernanceReadErrorKinds.Unavailable));
		await _WaitForGovernanceRead(function _Stale()
		{
			expect(store.usage.feedback().state).toBe(GovernanceReadStates.RetainedError);
			expect(store.usage.feedback().error).toContain("out of date");
			expect(store.usage.value()).toEqual(_Usage());
		});
	});

	it("clears only the endpoint denied with 403 and permits an explicit later recheck", async function _ForbiddenIsolation()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readTokenUsage.mockResolvedValue(_Usage());
		fixture.gateway.readAccountBudgets.mockResolvedValue([{ userId: "reader-a", currency: "USD", ceilingAmount: 10 }]);
		const store = TestBed.inject(UsageStore);
		await _WaitForGovernanceRead(function _Loaded() { expect(store.usage.busy() || store.globalBudget.busy() || store.accountBudgets.busy()).toBe(false); });
		fixture.gateway.readGlobalBudget.mockRejectedValueOnce(new GovernanceReadError(GovernanceReadErrorKinds.AccessDenied));
		store.refreshGlobalBudget();
		await _WaitForGovernanceRead(function _Denied()
		{
			expect(store.globalBudget.feedback().state).toBe(GovernanceReadStates.Forbidden);
			expect(store.globalBudget.value()).toBeNull();
			expect(store.usage.value()).toEqual(_Usage());
			expect(store.accountBudgets.value()).toHaveLength(1);
			expect(fixture.context.scope().identity).toBe("reader-a");
		});
		fixture.gateway.readGlobalBudget.mockResolvedValueOnce({ currency: "KES", ceilingAmount: 500 });
		store.refreshGlobalBudget();
		await _WaitForGovernanceRead(function _Readmitted() { expect(store.globalBudget.value()).toEqual({ currency: "KES", ceilingAmount: 500 }); });
	});
});

describe("usage store authentication and reader fences", function _Scope()
{
	it("lets a 401 clear every projection and reject late sibling successes", async function _UnauthenticatedSiblings()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readTokenUsage.mockResolvedValue(_Usage());
		fixture.gateway.readAccountBudgets.mockResolvedValue([{ userId: "reader-a", currency: "USD", ceilingAmount: 10 }]);
		const store = TestBed.inject(UsageStore);
		await _WaitForGovernanceRead(function _Loaded() { expect(store.usage.busy() || store.globalBudget.busy() || store.accountBudgets.busy()).toBe(false); });
		const usage = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		const global = _DeferredGovernanceRead<GovernanceBudget>();
		const accounts = _DeferredGovernanceRead<GovernanceAccountBudgets>();
		fixture.gateway.readTokenUsage.mockReturnValueOnce(usage.promise);
		fixture.gateway.readGlobalBudget.mockReturnValueOnce(global.promise);
		fixture.gateway.readAccountBudgets.mockReturnValueOnce(accounts.promise);
		store.refreshUsage(); store.refreshGlobalBudget(); store.refreshAccountBudgets();
		TestBed.tick();
		global.reject(new GovernanceReadError(GovernanceReadErrorKinds.Unauthenticated));
		await _WaitForGovernanceRead(function _Closed()
		{
			for (const snapshot of [store.usage, store.globalBudget, store.accountBudgets])
			{
				expect(snapshot.feedback().state).toBe(GovernanceReadStates.Unauthenticated);
				expect(snapshot.value()).toBeNull();
			}
			expect(fixture.context.scope().identity).toBeNull();
		});
		await _WaitForGovernanceRead(function _Cancelled()
		{
			expect(fixture.gateway.readTokenUsage.mock.calls[1][0]?.aborted).toBe(true);
			expect(fixture.gateway.readAccountBudgets.mock.calls[1][0]?.aborted).toBe(true);
		});
		usage.resolve(_Usage("late-reader-a"));
		accounts.resolve([{ userId: "late-reader-a", currency: "USD", ceilingAmount: 99 }]);
		await _WaitForGovernanceRead(function _StillClosed()
		{
			expect(store.usage.value()).toBeNull();
			expect(store.accountBudgets.value()).toBeNull();
			expect(store.globalBudget.value()).toBeNull();
		});
	});

	it("can explicitly retry after a 401 without treating the reader identity as permission", async function _SessionRetry()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readTokenUsage.mockRejectedValueOnce(new GovernanceReadError(GovernanceReadErrorKinds.Unauthenticated)).mockResolvedValueOnce(_Usage());
		const store = TestBed.inject(UsageStore);
		await _WaitForGovernanceRead(function _Closed() { expect(fixture.context.scope().identity).toBeNull(); expect(store.usage.busy()).toBe(false); });
		store.refreshUsage();
		await _WaitForGovernanceRead(function _Retried() { expect(store.usage.value()).toEqual(_Usage()); expect(store.globalBudget.feedback().state).toBe(GovernanceReadStates.Ready); });
		expect(fixture.gateway.readTokenUsage).toHaveBeenCalledTimes(2);
	});

	it("clears A to B to A and never adopts completions from either previous scope", async function _AccountSwitches()
	{
		const fixture = _GovernanceStoreFixture();
		const initial = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		const second = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		const returned = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		fixture.gateway.readTokenUsage.mockReturnValueOnce(initial.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(returned.promise);
		const store = TestBed.inject(UsageStore);
		TestBed.tick();
		const scopeA = fixture.context.scope();
		fixture.reader.set("reader-b");
		expect(store.usage.value()).toBeNull();
		TestBed.tick();
		initial.resolve(_Usage("old-reader-a"));
		await _WaitForGovernanceRead(function _BPending() { expect(fixture.gateway.readTokenUsage).toHaveBeenCalledTimes(2); expect(store.usage.value()).toBeNull(); });
		fixture.reader.set("reader-a");
		expect(store.usage.value()).toBeNull();
		expect(fixture.context.scope()).not.toBe(scopeA);
		TestBed.tick();
		second.resolve(_Usage("old-reader-b"));
		returned.resolve(_Usage("new-reader-a"));
		await _WaitForGovernanceRead(function _Returned() { expect(store.usage.value()).toEqual(_Usage("new-reader-a")); expect(store.usage.busy()).toBe(false); });
		expect(fixture.gateway.readTokenUsage.mock.calls[0][0]?.aborted).toBe(true);
		expect(fixture.gateway.readTokenUsage.mock.calls[1][0]?.aborted).toBe(true);
	});

	it("does not let an old scope's 401 invalidate the current reader", async function _LateUnauthenticated()
	{
		const fixture = _GovernanceStoreFixture();
		const old = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		fixture.gateway.readTokenUsage.mockReturnValueOnce(old.promise).mockResolvedValueOnce(_Usage("reader-b"));
		const store = TestBed.inject(UsageStore);
		TestBed.tick();
		fixture.reader.set("reader-b");
		await _WaitForGovernanceRead(function _BLoaded() { expect(store.usage.value()).toEqual(_Usage("reader-b")); });
		old.reject(new GovernanceReadError(GovernanceReadErrorKinds.Unauthenticated));
		await _WaitForGovernanceRead(function _Preserved() { expect(fixture.context.scope().identity).toBe("reader-b"); expect(store.usage.value()).toEqual(_Usage("reader-b")); });
	});

	it("clears every retained projection immediately on an account switch", async function _RetainedAccountSwitch()
	{
		const fixture = _GovernanceStoreFixture();
		fixture.gateway.readTokenUsage.mockResolvedValueOnce(_Usage());
		fixture.gateway.readGlobalBudget.mockResolvedValueOnce({ currency: "KES", ceilingAmount: 700 });
		fixture.gateway.readAccountBudgets.mockResolvedValueOnce([{ userId: "reader-a", currency: "KES", ceilingAmount: 30 }]);
		const store = TestBed.inject(UsageStore);
		await _WaitForGovernanceRead(function _Loaded()
		{
			expect(store.usage.value()).toEqual(_Usage());
			expect(store.globalBudget.value()).toEqual({ currency: "KES", ceilingAmount: 700 });
			expect(store.accountBudgets.value()).toHaveLength(1);
		});
		const usage = _DeferredGovernanceRead<GovernanceTokenUsageRows>();
		const global = _DeferredGovernanceRead<GovernanceBudget>();
		const accounts = _DeferredGovernanceRead<GovernanceAccountBudgets>();
		fixture.gateway.readTokenUsage.mockReturnValueOnce(usage.promise);
		fixture.gateway.readGlobalBudget.mockReturnValueOnce(global.promise);
		fixture.gateway.readAccountBudgets.mockReturnValueOnce(accounts.promise);
		fixture.reader.set("reader-b");
		for (const snapshot of [store.usage, store.globalBudget, store.accountBudgets])
			expect(snapshot.value()).toBeNull();
		TestBed.tick();
		usage.resolve(_Usage("reader-b")); global.resolve({ currency: "EUR", ceilingAmount: 8 }); accounts.resolve([]);
		await _WaitForGovernanceRead(function _BLoaded() { expect(store.usage.value()).toEqual(_Usage("reader-b")); expect(store.globalBudget.value()).toEqual({ currency: "EUR", ceilingAmount: 8 }); expect(store.accountBudgets.value()).toEqual([]); });
	});

	it("issues no read for a null identity, even when refresh is requested", async function _Anonymous()
	{
		const fixture = _GovernanceStoreFixture(null);
		const store = TestBed.inject(UsageStore);
		store.refreshUsage(); store.refreshGlobalBudget(); store.refreshAccountBudgets();
		await _WaitForGovernanceRead(function _NoAccess() { expect(store.usage.feedback().state).toBe(GovernanceReadStates.Unauthenticated); });
		for (const read of Object.values(fixture.gateway))
			expect(read).not.toHaveBeenCalled();
	});
});
