import { describe, expect, it } from "vitest";

import { ___DEFAULT_AWARENESS_WAVES, _NextWave, _NormalizeRollout, _PromoteNextWave, _PromoteToWave, _ResolveAwarenessVersion, _Rollback } from "../core/rollout.js";
import type { AwarenessRolloutState } from "../core/rollout.types.js";

/** Build a rollout state with overrides. */
function _state(over: Partial<AwarenessRolloutState> = {}): AwarenessRolloutState
{
	return {
		targetVersion: "awareness/v2alpha1",
		stableVersion: "awareness/v1alpha1",
		waves: ["personal", "project", "department", "org"],
		promotedWaves: [],
		shadowMode: false,
		...over,
	};
}

describe("awareness rollout engine (P4B.3)", function _suite()
{
	it("defaults to the locked canary order", function _waves()
	{
		expect(___DEFAULT_AWARENESS_WAVES).toEqual(["personal", "project", "department", "org"]);
	});

	it("resolves stable for un-promoted waves and target for promoted ones (canary)", function _resolve()
	{
		const state = _state({ promotedWaves: ["personal", "project"] });
		expect(_ResolveAwarenessVersion(state, "personal")).toMatchObject({ version: "awareness/v2alpha1", promoted: true });
		expect(_ResolveAwarenessVersion(state, "department")).toMatchObject({ version: "awareness/v1alpha1", promoted: false });
	});

	it("treats an unassigned tenant as the final (most-conservative) wave", function _unassigned()
	{
		// Only the last wave promoted → an unassigned tenant (→ org) is on target; otherwise stable.
		expect(_ResolveAwarenessVersion(_state({ promotedWaves: ["org"] }), null)).toMatchObject({ wave: "org", promoted: true });
		expect(_ResolveAwarenessVersion(_state({ promotedWaves: ["personal"] }), undefined)).toMatchObject({ wave: "org", promoted: false });
		// An unknown wave also falls back to the final wave.
		expect(_ResolveAwarenessVersion(_state({ promotedWaves: [] }), "bogus")).toMatchObject({ wave: "org", promoted: false });
	});

	it("shadow mode serves stable for promoted waves while flagging shadow", function _shadow()
	{
		const r = _ResolveAwarenessVersion(_state({ promotedWaves: ["personal"], shadowMode: true }), "personal");
		expect(r).toMatchObject({ version: "awareness/v1alpha1", promoted: true, shadow: true });
	});

	it("promotes one wave at a time in order and reports the next wave", function _promoteNext()
	{
		let state = _state();
		expect(_NextWave(state)).toBe("personal");
		state = _PromoteNextWave(state);
		expect(state.promotedWaves).toEqual(["personal"]);
		expect(_NextWave(state)).toBe("project");
		state = _PromoteNextWave(_PromoteNextWave(_PromoteNextWave(state)));
		expect(state.promotedWaves).toEqual(["personal", "project", "department", "org"]);
		// Idempotent once complete.
		expect(_NextWave(state)).toBeNull();
		expect(_PromoteNextWave(state).promotedWaves).toHaveLength(4);
	});

	it("promotes up to a named wave", function _promoteTo()
	{
		const state = _PromoteToWave(_state(), "department");
		expect(state.promotedWaves).toEqual(["personal", "project", "department"]);
	});

	it("throws promoting to an unknown wave", function _badWave()
	{
		expect(function _call() { _PromoteToWave(_state(), "nope"); }).toThrow(/unknown wave/);
	});

	it("rolls back to no promoted waves in one step (retaining the definition)", function _rollback()
	{
		const rolledBack = _Rollback(_state({ promotedWaves: ["personal", "project", "department"] }));
		expect(rolledBack.promotedWaves).toEqual([]);
		expect(rolledBack.targetVersion).toBe("awareness/v2alpha1");
		expect(_ResolveAwarenessVersion(rolledBack, "personal").version).toBe("awareness/v1alpha1");
	});

	it("normalizes: rejects blank versions/empty/duplicate waves and filters stray promoted waves", function _normalize()
	{
		expect(function _v() { _NormalizeRollout(_state({ targetVersion: " " })); }).toThrow(/required/);
		expect(function _e() { _NormalizeRollout(_state({ waves: [] })); }).toThrow(/at least one wave/);
		expect(function _d() { _NormalizeRollout(_state({ waves: ["a", "a"] })); }).toThrow(/unique/);
		const n = _NormalizeRollout(_state({ promotedWaves: ["project", "ghost"] }));
		expect(n.promotedWaves).toEqual(["project"]);
	});
});
