import { afterEach, describe, expect, it, vi } from "vitest";

import { __RunInputAuthorityExpiresAt } from "../run-input-authority-expiry";

/** Supplies original snapshot ceilings independently of the clock used for a later retry. */
function _Fixture(execution = 9_000, requester = 8_000, deadline = 7_000)
{
	const snapshot = { runId: "run-1", attempt: 1, siloId: "silo-1", budgetPolicy: { wallClockDeadlineEpochMs: deadline }, executionSubject: { siloId: "silo-1", principalId: "principal-1", agentIdentityId: "identity-1", computerScope: { computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, runScope: { runId: "run-1", attempt: 1, siloId: "silo-1" }, membership: { kind: "fleet", principalId: "principal-1", siloId: "silo-1", trustedUntil: new Date(execution).toISOString() }, requester: { membership: { kind: "fleet", principalId: "principal-1", siloId: "silo-1", trustedUntil: new Date(requester).toISOString() } } } };
	const compiled = { runId: "run-1", attempt: 1, budget: { maxModelTurns: 1, maxCompletionTokens: 4_096, wallClockDeadlineEpochMs: deadline } };
	return { snapshot, compiled };
}

afterEach(function _RestoreClock() { vi.useRealTimers(); });

describe("__RunInputAuthorityExpiresAt", function _Suite()
{
	it.each([[6_000, 8_000, 7_000], [9_000, 6_000, 7_000], [9_000, 8_000, 6_000]])("retains the earliest of execution %s, requester %s and budget %s", function _Caps(execution, requester, deadline)
	{
		const f = _Fixture(execution, requester, deadline);
		expect(__RunInputAuthorityExpiresAt(f.snapshot as never, f.compiled as never, f.snapshot.executionSubject as never)).toBe(new Date(6_000).toISOString());
	});

	it.each(["execution", "requester"])("narrows the %s deadline from refreshed evidence without changing the snapshot", function _CurrentCeiling(kind)
	{
		const f = _Fixture();
		const current = structuredClone(f.snapshot.executionSubject);
		const evidence = kind === "execution" ? current.membership : current.requester.membership;
		evidence.trustedUntil = new Date(5_000).toISOString();
		expect(__RunInputAuthorityExpiresAt(f.snapshot as never, f.compiled as never, current as never)).toBe(new Date(5_000).toISOString());
		expect(f.snapshot.executionSubject.membership.trustedUntil).toBe(new Date(9_000).toISOString());
		expect(f.snapshot.executionSubject.requester.membership.trustedUntil).toBe(new Date(8_000).toISOString());
		evidence.trustedUntil = new Date(50_000).toISOString();
		expect(__RunInputAuthorityExpiresAt(f.snapshot as never, f.compiled as never, current as never)).toBe(new Date(7_000).toISOString());
	});

	it("refuses expiry evidence belonging to another current identity", function _OtherIdentity()
	{
		const f = _Fixture();
		expect(() => __RunInputAuthorityExpiresAt(f.snapshot as never, f.compiled as never, { ...f.snapshot.executionSubject, principalId: "other" } as never)).toThrow("same currently verified subject");
	});

	it("does not extend an expired original deadline when a retry runs later", function _KeepsOriginal()
	{
		const f = _Fixture();
		vi.useFakeTimers();
		vi.setSystemTime(100_000);
		expect(__RunInputAuthorityExpiresAt(f.snapshot as never, f.compiled as never, f.snapshot.executionSubject as never)).toBe(new Date(7_000).toISOString());
		vi.setSystemTime(200_000);
		expect(__RunInputAuthorityExpiresAt(f.snapshot as never, f.compiled as never, f.snapshot.executionSubject as never)).toBe(new Date(7_000).toISOString());
	});

	it.each([{ runId: "other" }, { attempt: 2 }, { attempt: 0 }])("rejects changed run or attempt binding %j", function _RejectsBinding(patch)
	{
		const f = _Fixture();
		expect(() => __RunInputAuthorityExpiresAt(f.snapshot as never, { ...f.compiled, ...patch } as never, f.snapshot.executionSubject as never)).toThrow("original bound run attempt");
	});

	it.each([null, 0, -1, Infinity, Number.NaN, 9e15])("rejects unbounded or unrepresentable deadline %s", function _RejectsDeadline(deadline)
	{
		const f = _Fixture();
		expect(() => __RunInputAuthorityExpiresAt(f.snapshot as never, { ...f.compiled, budget: { ...f.compiled.budget, wallClockDeadlineEpochMs: deadline } } as never, f.snapshot.executionSubject as never)).toThrow("bounded compiled budget");
	});

	it("rejects a replaced absolute budget or malformed evidence expiry", function _RejectsReplacement()
	{
		const f = _Fixture();
		expect(() => __RunInputAuthorityExpiresAt(f.snapshot as never, { ...f.compiled, budget: { ...f.compiled.budget, wallClockDeadlineEpochMs: 12_000 } } as never, f.snapshot.executionSubject as never)).toThrow("original budget deadline");
		f.snapshot.executionSubject.requester.membership.trustedUntil = "not-a-date";
		expect(() => __RunInputAuthorityExpiresAt(f.snapshot as never, f.compiled as never, f.snapshot.executionSubject as never)).toThrow("canonical evidence expiry");
	});
});
