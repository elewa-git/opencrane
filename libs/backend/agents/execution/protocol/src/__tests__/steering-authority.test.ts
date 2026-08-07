import { describe, expect, it } from "vitest";

import { __AdmitModelTerminal, __ClaimSteeringBoundary } from "../steering-authority.js";
import type { SteeringBoundaryClaim, SteeringBoundaryClaimResult, SteeringBoundaryRepository } from "../steering-authority.types.js";

/** In-memory exactly-once boundary recorder that survives a simulated process death. */
class _Repository implements SteeringBoundaryRepository
{
	/** Recorded claims keyed by their deterministic boundary id. */
	readonly recorded = new Map<string, SteeringBoundaryClaim>();

	async claim(claim: SteeringBoundaryClaim): Promise<SteeringBoundaryClaimResult>
	{
		const existing = this.recorded.get(claim.boundaryId);
		if (existing) return { status: "existing", disposition: existing.disposition, toInputGeneration: existing.toInputGeneration, steeringDigest: existing.steeringDigest };
		this.recorded.set(claim.boundaryId, claim);
		return { status: "claimed" };
	}
}

describe("steering authority", function _suite()
{
	it("absorbs buffered steering and advances the input generation exactly once", async function _absorb()
	{
		const repository = new _Repository();
		const result = await __ClaimSteeringBoundary(repository, { runId: "run-1", attempt: 1, fromInputGeneration: 0, pendingSteering: { steeringDigest: "sha256:s" } });
		expect(result.disposition).toBe("absorbed");
		expect(result.toInputGeneration).toBe(1);
		expect(result.replayed).toBe(false);
	});

	it("defers when nothing is buffered and leaves the input generation unchanged", async function _defer()
	{
		const repository = new _Repository();
		const result = await __ClaimSteeringBoundary(repository, { runId: "run-1", attempt: 1, fromInputGeneration: 3, pendingSteering: null });
		expect(result.disposition).toBe("deferred");
		expect(result.toInputGeneration).toBe(3);
	});

	it("replays the recorded disposition across process death rather than re-absorbing", async function _replay()
	{
		const repository = new _Repository();
		const command = { runId: "run-1", attempt: 1, fromInputGeneration: 0, pendingSteering: { steeringDigest: "sha256:s" } } as const;
		const first = await __ClaimSteeringBoundary(repository, command);
		// A crash-and-reconnect re-issues the identical claim; the boundary id is deterministic.
		const second = await __ClaimSteeringBoundary(repository, command);
		expect(first.boundaryId).toBe(second.boundaryId);
		expect(second.replayed).toBe(true);
		expect(second.disposition).toBe("absorbed");
		expect(second.toInputGeneration).toBe(1);
		expect(repository.recorded.size).toBe(1);
	});

	it("emits exactly one disposition even if a deferral is replayed after acknowledgement", async function _deferReplay()
	{
		const repository = new _Repository();
		const command = { runId: "run-1", attempt: 2, fromInputGeneration: 5, pendingSteering: null } as const;
		await __ClaimSteeringBoundary(repository, command);
		const replay = await __ClaimSteeringBoundary(repository, command);
		expect(replay.replayed).toBe(true);
		expect(replay.disposition).toBe("deferred");
		expect(repository.recorded.size).toBe(1);
	});

	it("rejects a model terminal produced under a superseded input generation", function _stale()
	{
		expect(__AdmitModelTerminal({ currentInputGeneration: 2, terminalInputGeneration: 1 })).toEqual({ outcome: "rejected", reason: "stale_input_generation" });
		expect(__AdmitModelTerminal({ currentInputGeneration: 2, terminalInputGeneration: 2 })).toEqual({ outcome: "accepted" });
	});
});
