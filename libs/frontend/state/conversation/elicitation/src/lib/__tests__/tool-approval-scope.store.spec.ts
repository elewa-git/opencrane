// @vitest-environment jsdom

import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToolApprovalScopeStates, type ToolApprovalScopeSummary } from "@opencrane/contracts";

import { TOOL_APPROVAL_SCOPE_GATEWAY } from "../opencrane-tool-approval-scope.gateway";
import { ToolApprovalScopeGatewayError, ToolApprovalScopeGatewayErrorKinds } from "../tool-approval-scope.errors";
import { ToolApprovalScopeStore } from "../tool-approval-scope.store";
import { TOOL_APPROVAL_SCOPE_SESSION, ToolApprovalScopeReadStates, type ToolApprovalScopeGateway } from "../tool-approval-scope.types";

/** One active safe owner summary. */
const _ACTIVE: ToolApprovalScopeSummary = { id: "scope-1", state: ToolApprovalScopeStates.Active, action: "Create event", target: "Operations calendar", externalSystem: "Company calendar", assistantLabel: "Operations assistant", connectionOwnerLabel: "Amina", createdAt: "2026-09-25T08:00:00.000Z" };

/** Build a narrow port double and verified-session signal. */
function _Fixture()
{
	const scope = signal<string | null>("account-a");
	const gateway: ToolApprovalScopeGateway = { list: vi.fn().mockResolvedValue({ scopes: [_ACTIVE] }), revoke: vi.fn() };
	const revalidate = vi.fn();
	TestBed.configureTestingModule({ providers: [ToolApprovalScopeStore, { provide: TOOL_APPROVAL_SCOPE_SESSION, useValue: { scope, revalidate } }, { provide: TOOL_APPROVAL_SCOPE_GATEWAY, useValue: gateway }] });
	return { scope, revalidate, gateway, store: TestBed.inject(ToolApprovalScopeStore) };
}

/** Let Angular effects and resolved gateway promises settle. */
async function _Flush(): Promise<void> { TestBed.flushEffects(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

beforeAll(function _InitializeAngularTesting()
{
	TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
	vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue("revoke-key-1") });
});
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { vi.unstubAllGlobals(); TestBed.resetTestEnvironment(); });

describe("ToolApprovalScopeStore", function _ToolApprovalScopeStoreSuite()
{
	it("follows only the returned opaque cursor and purges rows synchronously on identity change", async function _PaginationAndIdentity()
	{
		const f = _Fixture();
		vi.mocked(f.gateway.list).mockResolvedValueOnce({ scopes: [_ACTIVE], nextCursor: "opaque-next" }).mockResolvedValueOnce({ scopes: [{ ..._ACTIVE, id: "scope-2", target: "Supplier portal" }] });
		await _Flush();
		expect(f.store.hasMore()).toBe(true);
		await f.store.loadMore();
		expect(f.gateway.list).toHaveBeenLastCalledWith("opaque-next", expect.any(AbortSignal));
		expect(f.store.scopes().map(scope => scope.id)).toEqual(["scope-1", "scope-2"]);
		f.scope.set("account-b");
		expect(f.store.scopes()).toEqual([]);
	});

	it("keeps one command per scope while allowing a different scope to revoke", async function _PerScopeConcurrency()
	{
		const f = _Fixture();
		vi.mocked(f.gateway.list).mockResolvedValue({ scopes: [_ACTIVE, { ..._ACTIVE, id: "scope-2" }] });
		await _Flush();
		let finishFirst!: (value: { scope: ToolApprovalScopeSummary; idempotent: boolean }) => void;
		vi.mocked(f.gateway.revoke).mockImplementationOnce(function _Hold() { return new Promise(function _Pending(resolve) { finishFirst = resolve; }); }).mockResolvedValueOnce({ scope: { ..._ACTIVE, id: "scope-2", state: ToolApprovalScopeStates.Revoked, revokedAt: "2026-09-25T09:00:00.000Z" }, idempotent: false });
		const first = f.store.revoke("scope-1");
		const duplicate = f.store.revoke("scope-1");
		await f.store.revoke("scope-2");
		expect(f.gateway.revoke).toHaveBeenCalledTimes(2);
		finishFirst({ scope: { ..._ACTIVE, state: ToolApprovalScopeStates.Revoked, revokedAt: "2026-09-25T09:00:00.000Z" }, idempotent: false });
		await Promise.all([first, duplicate]);
		expect(f.store.scopes().every(scope => scope.state === ToolApprovalScopeStates.Revoked)).toBe(true);
	});

	it("reuses the saved key after an uncertain result until authoritative revoked state returns", async function _UncertainRetry()
	{
		const f = _Fixture();
		await _Flush();
		vi.mocked(f.gateway.revoke).mockRejectedValueOnce(new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Uncertain)).mockResolvedValueOnce({ scope: { ..._ACTIVE, state: ToolApprovalScopeStates.Revoked, revokedAt: "2026-09-25T09:00:00.000Z" }, idempotent: true });
		vi.mocked(f.gateway.list).mockResolvedValue({ scopes: [_ACTIVE] });
		await f.store.revoke(_ACTIVE.id);
		expect(f.store.commandErrors()[_ACTIVE.id]).toContain("could not confirm");
		await f.store.revoke(_ACTIVE.id);
		expect(vi.mocked(f.gateway.revoke).mock.calls.map(call => call[1])).toEqual(["revoke-key-1", "revoke-key-1"]);
		expect(f.store.scopes()[0]?.state).toBe(ToolApprovalScopeStates.Revoked);
		expect(f.store.commandErrors()[_ACTIVE.id]).toBeUndefined();
	});

	it("keeps readable summaries when only revoke permission is refused", async function _RevokeForbidden()
	{
		const f = _Fixture();
		await _Flush();
		vi.mocked(f.gateway.revoke).mockRejectedValueOnce(new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Forbidden));
		await f.store.revoke(_ACTIVE.id);
		expect(f.revalidate).not.toHaveBeenCalled();
		expect(f.gateway.list).toHaveBeenCalledTimes(2);
		expect(f.store.scopes()).toEqual([_ACTIVE]);
		expect(f.store.commandErrors()[_ACTIVE.id]).toContain("no longer have permission");
	});

	it("retries a denied list after revalidation even when the identity key is unchanged", async function _SameScopeRevalidation()
	{
		const f = _Fixture();
		vi.mocked(f.gateway.list).mockReset().mockRejectedValueOnce(new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Forbidden)).mockResolvedValueOnce({ scopes: [_ACTIVE] });
		await _Flush();
		expect(f.store.scopes()).toEqual([]);
		expect(f.store.readState()).toBe(ToolApprovalScopeReadStates.Unavailable);
		await f.store.refresh();
		expect(f.revalidate).toHaveBeenCalledTimes(2);
		expect(f.store.scopes()).toEqual([_ACTIVE]);
		expect(f.store.readState()).toBe(ToolApprovalScopeReadStates.Ready);
	});

	it("ignores an old identity reconciliation failure after a new identity is loaded", async function _StaleReconciliationFailure()
	{
		const f = _Fixture();
		await _Flush();
		let rejectOld!: (error: unknown) => void;
		const oldRead = new Promise<never>(function _Pending(_resolve, reject) { rejectOld = reject; });
		const current = { ..._ACTIVE, id: "scope-current", target: "Current account calendar" };
		vi.mocked(f.gateway.revoke).mockRejectedValueOnce(new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Uncertain));
		vi.mocked(f.gateway.list).mockImplementationOnce(function _OldRead() { return oldRead; }).mockResolvedValueOnce({ scopes: [current] });
		const revoke = f.store.revoke(_ACTIVE.id);
		await Promise.resolve();
		await Promise.resolve();
		f.scope.set("account-b");
		TestBed.flushEffects();
		await Promise.resolve();
		await Promise.resolve();
		rejectOld(new ToolApprovalScopeGatewayError(ToolApprovalScopeGatewayErrorKinds.Forbidden));
		await revoke;
		expect(f.store.scopes()).toEqual([current]);
		expect(f.store.readState()).toBe(ToolApprovalScopeReadStates.Ready);
		expect(f.revalidate).not.toHaveBeenCalled();
	});
});
