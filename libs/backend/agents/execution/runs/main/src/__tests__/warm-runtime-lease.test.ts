import { describe, expect, it } from "vitest";

import { __ValidateWarmRuntimeLease } from "../warm-runtime-lease";

const _NOW = new Date("2026-08-31T10:00:00.000Z");
const _LATER = new Date("2026-08-31T11:00:00.000Z");
const _EARLIER = new Date("2026-08-31T09:00:00.000Z");
const _IDENTITY = { namespace: "personal-runtime", serviceAccountName: "warm-runtime", podUid: "pod-1" } as const;

/** Live assignment matching the test identity. */
function _Assignment(overrides: Record<string, unknown> = {})
{
	return { namespace: "personal-runtime", serviceAccountName: "warm-runtime", state: "Registered", revokedAt: null, expiresAt: _LATER, workloadKind: "Deployment", bindingGeneration: 2, ...overrides };
}

/** Claimed reservation for the assignment's current generation held by the test Pod. */
function _Reservation(overrides: Record<string, unknown> = {})
{
	return { generation: 2, state: "Claimed", namespace: "personal-runtime", serviceAccountName: "warm-runtime", podUid: "pod-1", idleDeadline: _LATER, ...overrides };
}

describe("__ValidateWarmRuntimeLease", function _Suite()
{
	it("accepts the exact live assignment and claimed current-generation reservation", function _Accepts()
	{
		expect(__ValidateWarmRuntimeLease(_IDENTITY, _Assignment(), _Reservation(), _NOW)).toBe(true);
		expect(__ValidateWarmRuntimeLease(_IDENTITY, _Assignment(), _Reservation(), _NOW, ["personal-runtime", "managed-runtime"])).toBe(true);
	});

	it("denies a missing row on either side", function _DeniesMissing()
	{
		expect(__ValidateWarmRuntimeLease(_IDENTITY, null, _Reservation(), _NOW)).toBe(false);
		expect(__ValidateWarmRuntimeLease(_IDENTITY, _Assignment(), null, _NOW)).toBe(false);
	});

	it("denies an assignment that is not a live registered Deployment for this caller", function _DeniesAssignment()
	{
		const stale = [
			_Assignment({ namespace: "other" }),
			_Assignment({ serviceAccountName: "other" }),
			_Assignment({ state: "PendingPod" }),
			_Assignment({ revokedAt: _EARLIER }),
			_Assignment({ expiresAt: _EARLIER }),
			_Assignment({ expiresAt: _NOW }),
			_Assignment({ workloadKind: "Job" }),
		];
		for (const assignment of stale)
		{
			expect(__ValidateWarmRuntimeLease(_IDENTITY, assignment, _Reservation(), _NOW)).toBe(false);
		}
	});

	it("denies a reservation that is not the claimed current generation held by this Pod", function _DeniesReservation()
	{
		const stale = [
			_Reservation({ generation: 1 }),
			_Reservation({ state: "Ready" }),
			_Reservation({ namespace: "other" }),
			_Reservation({ serviceAccountName: "other" }),
			_Reservation({ podUid: "pod-2" }),
			_Reservation({ idleDeadline: _EARLIER }),
			_Reservation({ idleDeadline: _NOW }),
		];
		for (const reservation of stale)
		{
			expect(__ValidateWarmRuntimeLease(_IDENTITY, _Assignment(), reservation, _NOW)).toBe(false);
		}
	});

	it("denies a caller outside the configured runtime namespaces", function _DeniesForeignPlane()
	{
		expect(__ValidateWarmRuntimeLease(_IDENTITY, _Assignment(), _Reservation(), _NOW, ["managed-runtime"])).toBe(false);
	});
});
