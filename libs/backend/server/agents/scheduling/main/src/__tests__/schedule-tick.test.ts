import { describe, expect, it } from "vitest";

import type { AgentRevisionLifecycleDenial, ManagedRunAdmissionResult, ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

import { __NextBackoffDelayMs, __RunScheduleTick, __ScheduledRunIdempotencyKey } from "../schedule-tick.js";
import type { AgentServiceSchedule, ScheduleTickDependencies } from "../schedule-tick.types.js";

/** Admission port that dedups by idempotency key exactly like `@@unique([siloId, requestIdempotencyKey])`. */
class _DedupingAdmission
{
	/** Runs already admitted, keyed by `siloId∥key`, mirroring the durable unique constraint. */
	private readonly admitted = new Map<string, string>();
	/** Every command received, so a test can assert how many admissions were attempted. */
	readonly commands: ManagedRunNowCommand[] = [];
	/** Monotonic run-id source. */
	private next = 0;

	/** Admits a run or returns the first admission for a duplicate key. */
	async admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>
	{
		this.commands.push(command);
		const dedupKey = `${command.siloId}\u0000${command.requestIdempotencyKey}`;
		const existing = this.admitted.get(dedupKey);
		if (existing !== undefined) return { outcome: "idempotent", runId: existing };
		const runId = `run-${(this.next += 1)}`;
		this.admitted.set(dedupKey, runId);
		return { outcome: "accepted", runId };
	}
}

/** Admission port that always fails with a fixed reason, for denial/backoff coverage. */
class _DenyingAdmission
{
	constructor(private readonly reason: AgentRevisionLifecycleDenial) {}
	readonly commands: ManagedRunNowCommand[] = [];
	async admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>
	{
		this.commands.push(command);
		return { outcome: "denied", reason: this.reason };
	}
}

/** Builds tick dependencies over an admission port with an optional active-run flag. */
function _deps(admission: { admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult> }, now: string, hasActive = false): ScheduleTickDependencies
{
	return {
		admission,
		activeRuns: { async hasActiveScheduledRun(): Promise<boolean> { return hasActive; } },
		clock: { now(): Date { return new Date(now); } },
		schedulerSubjectId: "system:scheduler",
		maxSlotsPerTick: 100,
			backoff: { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 },
	};
}

/** Builds an hourly UTC schedule fixture. */
function _schedule(overrides: Partial<AgentServiceSchedule> = {}): AgentServiceSchedule
{
	return { id: "sched-1", siloId: "silo-1", agentServiceId: "svc-1", cron: "0 * * * *", timezone: "UTC", overlapPolicy: "allow", enabled: true, catchupWindowSeconds: 86_400, lastScheduledAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

describe("scheduled-run idempotency key", function _KeySuite()
{
	it("is deterministic per (service, revision, slot) and distinct across slots", function _Deterministic()
	{
		const a = __ScheduledRunIdempotencyKey("svc-1", "rev-1", "2026-07-01T01:00:00.000Z");
		const b = __ScheduledRunIdempotencyKey("svc-1", "rev-1", "2026-07-01T01:00:00.000Z");
		const c = __ScheduledRunIdempotencyKey("svc-1", "rev-1", "2026-07-01T02:00:00.000Z");
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^schedule_[a-f0-9]{64}$/);
	});
});

describe("exponential backoff", function _BackoffSuite()
{
	it("grows exponentially and is capped", function _Grows()
	{
			const policy = { baseDelayMs: 1_000, factor: 2, maxDelayMs: 10_000 };
		expect(__NextBackoffDelayMs(1, policy)).toBe(1_000);
		expect(__NextBackoffDelayMs(2, policy)).toBe(2_000);
		expect(__NextBackoffDelayMs(3, policy)).toBe(4_000);
		expect(__NextBackoffDelayMs(10, policy)).toBe(10_000);
	});
});

describe("schedule tick", function _TickSuite()
{
	it("admits every missed slot on catch-up, oldest first", async function _CatchUp()
	{
		const admission = new _DedupingAdmission();
		const result = await __RunScheduleTick(_schedule(), "rev-1", _deps(admission, "2026-07-01T03:30:00.000Z"));
		expect(result.status).toBe("ticked");
		if (result.status !== "ticked") throw new Error("expected ticked");
		expect(result.outcomes.map(o => o.slot)).toEqual(["2026-07-01T01:00:00.000Z", "2026-07-01T02:00:00.000Z", "2026-07-01T03:00:00.000Z"]);
		expect(result.outcomes.every(o => o.outcome === "accepted")).toBe(true);
		expect(result.nextLastScheduledAt).toBe("2026-07-01T03:00:00.000Z");
		expect(admission.commands.every(c => c.trigger === "schedule")).toBe(true);
	});

	it("dedups the same slot across two concurrent ticks", async function _ConcurrentDedup()
	{
		const admission = new _DedupingAdmission();
		const [first, second] = await Promise.all([
			__RunScheduleTick(_schedule(), "rev-1", _deps(admission, "2026-07-01T01:30:00.000Z")),
			__RunScheduleTick(_schedule(), "rev-1", _deps(admission, "2026-07-01T01:30:00.000Z")),
		]);
		if (first.status !== "ticked" || second.status !== "ticked") throw new Error("expected ticked");
		const outcomes = [...first.outcomes, ...second.outcomes];
		expect(outcomes.filter(o => o.outcome === "accepted")).toHaveLength(1);
		expect(outcomes.filter(o => o.outcome === "idempotent")).toHaveLength(1);
		// Both ticks target one durable run for the 01:00 slot.
		const runIds = new Set(outcomes.filter(o => o.outcome === "accepted" || o.outcome === "idempotent").map(o => (o as { runId: string }).runId));
		expect(runIds.size).toBe(1);
	});

		it("skips overlapping slots when a prior scheduled run is active", async function _OverlapSkip()
	{
		const admission = new _DedupingAdmission();
		const result = await __RunScheduleTick(_schedule({ overlapPolicy: "skip" }), "rev-1", _deps(admission, "2026-07-01T03:30:00.000Z", true));
		if (result.status !== "ticked") throw new Error("expected ticked");
		expect(result.outcomes.every(o => o.outcome === "skipped_overlap")).toBe(true);
		expect(admission.commands).toHaveLength(0);
		// The cursor still advances so the skipped slots never re-fire once the active run ends.
		expect(result.nextLastScheduledAt).toBe("2026-07-01T03:00:00.000Z");
		});

		it("admits only the oldest catch-up slot under skip when no run is active yet", async function _SkipCapsCatchUp()
		{
			const admission = new _DedupingAdmission();
			const result = await __RunScheduleTick(_schedule({ overlapPolicy: "skip" }), "rev-1", _deps(admission, "2026-07-01T03:30:00.000Z", false));
			if (result.status !== "ticked") throw new Error("expected ticked");
			expect(result.outcomes.map(o => o.slot)).toEqual(["2026-07-01T01:00:00.000Z"]);
			expect(result.outcomes[0]?.outcome).toBe("accepted");
			expect(result.nextLastScheduledAt).toBe("2026-07-01T01:00:00.000Z");
			expect(admission.commands).toHaveLength(1);
		});

	it("admits overlapping slots under the allow policy", async function _OverlapAllow()
	{
		const admission = new _DedupingAdmission();
		const result = await __RunScheduleTick(_schedule({ overlapPolicy: "allow" }), "rev-1", _deps(admission, "2026-07-01T02:30:00.000Z", true));
		if (result.status !== "ticked") throw new Error("expected ticked");
		expect(admission.commands).toHaveLength(2);
	});

	it("schedules a backed-off retry and stops advancing on a transient denial", async function _TransientRetry()
	{
		const admission = new _DenyingAdmission("run_admission_unavailable");
		const result = await __RunScheduleTick(_schedule(), "rev-1", _deps(admission, "2026-07-01T02:30:00.000Z"));
		if (result.status !== "ticked") throw new Error("expected ticked");
		const first = result.outcomes[0];
			expect(first.outcome).toBe("retry_hint");
			if (first.outcome !== "retry_hint") throw new Error("expected retry hint");
		expect(first.retryAfterMs).toBe(1_000);
		// Cursor is NOT advanced past the failed slot, so the next tick retries it.
		expect(result.nextLastScheduledAt).toBe("2026-07-01T00:00:00.000Z");
		// Only the first due slot was attempted before stopping.
		expect(admission.commands).toHaveLength(1);
	});

	it("retries a capacity rejection without advancing the schedule cursor", async function _CapacityRetry()
	{
		const admission = new _DenyingAdmission("admission_concurrency_limited");
		const result = await __RunScheduleTick(_schedule(), "rev-1", _deps(admission, "2026-07-01T02:30:00.000Z"));
		if (result.status !== "ticked") throw new Error("expected ticked");
		expect(result.outcomes[0]).toMatchObject({ outcome: "retry_hint", reason: "admission_concurrency_limited", retryAfterMs: 1_000 });
		expect(result.nextLastScheduledAt).toBe("2026-07-01T00:00:00.000Z");
	});

	it("records a permanent denial and advances past it", async function _PermanentDeny()
	{
		const admission = new _DenyingAdmission("service_not_runnable");
		const result = await __RunScheduleTick(_schedule(), "rev-1", _deps(admission, "2026-07-01T02:30:00.000Z"));
		if (result.status !== "ticked") throw new Error("expected ticked");
		expect(result.outcomes.every(o => o.outcome === "denied")).toBe(true);
		expect(result.nextLastScheduledAt).toBe("2026-07-01T02:00:00.000Z");
	});

	it("is suspended when disabled and never touches admission", async function _Suspended()
	{
		const admission = new _DedupingAdmission();
		const result = await __RunScheduleTick(_schedule({ enabled: false }), "rev-1", _deps(admission, "2026-07-01T03:30:00.000Z"));
		expect(result.status).toBe("suspended");
		expect(admission.commands).toHaveLength(0);
	});

	it("fails closed on an invalid cron, timezone, or missing active revision", async function _Invalid()
	{
		const admission = new _DedupingAdmission();
		expect((await __RunScheduleTick(_schedule({ cron: "bad" }), "rev-1", _deps(admission, "2026-07-01T03:30:00.000Z"))).status).toBe("invalid_schedule");
		expect((await __RunScheduleTick(_schedule({ timezone: "Not/AZone" }), "rev-1", _deps(admission, "2026-07-01T03:30:00.000Z"))).status).toBe("invalid_schedule");
		expect((await __RunScheduleTick(_schedule(), null, _deps(admission, "2026-07-01T03:30:00.000Z"))).status).toBe("invalid_schedule");
	});
});
