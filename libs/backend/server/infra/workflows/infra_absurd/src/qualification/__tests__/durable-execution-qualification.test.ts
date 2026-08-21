import type { Absurd } from "absurd-sdk";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { DurableExecutionTransaction, DurableTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import type { AbsurdDurableExecution } from "../../absurd-durable-execution";
import type { DurableQualificationUnitOfWork } from "../durable-qualification-unit-of-work.types";
import { __QualifyDurableExecutionPickup, _DurableExecutionQualificationPassed, _DurableExecutionQualificationPercentile } from "../durable-execution-qualification";
import { _AbsurdDurableExecutionQualificationSession } from "../durable-execution-qualification-session";
import type { _DurableExecutionQualificationInput, _DurableExecutionQualificationSession } from "../durable-execution-qualification-session.types";

const _Options = {
	databasePoolSize: 2,
	databaseUrl: "postgresql://example.invalid/opencrane",
	pollIntervalMs: 50,
	sampleCount: 10,
	siloId: "testlynn",
	thresholdMs: 250,
};

/** Create one controllable session for runner orchestration tests. */
function _FakeSession(connectionCount: number | null = 3)
{
	let onStarted: ((input: _DurableExecutionQualificationInput) => void) | undefined;
	let currentTime = 0;
	const events: string[] = [];
	const session: _DurableExecutionQualificationSession = {
		async start(handler): Promise<void> { events.push("start"); onStarted = handler; },
		async admit(input)
		{
			events.push(`admit:${input.sampleIndex}`);
			currentTime += 100;
			onStarted?.(input);
			return { taskId: `task-${input.sampleIndex}`, taskName: "qualification", idempotencyKey: `${input.sampleIndex}` };
		},
		async connectionCount(): Promise<number | null> { events.push("observe"); return connectionCount; },
		async close(): Promise<void> { events.push("close"); },
	};
	return {
		events,
		runtime: {
			createSession: function _Create(): _DurableExecutionQualificationSession { return session; },
			now: function _Now(): number { return currentTime; },
			async wait(): Promise<void> {},
			async withTimeout(sample: Promise<number>): Promise<number> { return await sample; },
		},
		session,
	};
}

describe("durable execution live qualification statistics", function _Suite()
{
	it("uses nearest-rank percentiles over monotonic samples", function _Percentiles()
	{
		const samples = [8, 1, 5, 3, 2, 7, 4, 6, 10, 9];
		expect(_DurableExecutionQualificationPercentile(samples, 0.5)).toBe(5);
		expect(_DurableExecutionQualificationPercentile(samples, 0.95)).toBe(10);
		expect(_DurableExecutionQualificationPercentile(samples, 0.99)).toBe(10);
	});

	it("rejects an empty or invalid percentile request", function _RejectsInvalid()
	{
		expect(function _Empty(): number { return _DurableExecutionQualificationPercentile([], 0.95); }).toThrow("requires samples");
		expect(function _Rank(): number { return _DurableExecutionQualificationPercentile([1], 2); }).toThrow("requires samples");
	});

	it("fails closed without complete connection evidence or above the connection ceiling", function _ConnectionBudget()
	{
		expect(_DurableExecutionQualificationPassed(200, 250, 3, { available: false })).toBe(false);
		expect(_DurableExecutionQualificationPassed(200, 250, 3, { available: true, peakConnections: 4 })).toBe(false);
		expect(_DurableExecutionQualificationPassed(200, 250, 3, { available: true, peakConnections: 3 })).toBe(true);
		expect(_DurableExecutionQualificationPassed(300, 250, 3, { available: true, peakConnections: 3 })).toBe(false);
	});

	it("measures through a fake session and always closes it", async function _RunsSessionBoundary()
	{
		const fake = _FakeSession();

		const result = await __QualifyDurableExecutionPickup(_Options, fake.runtime);

		expect(result.passed).toBe(true);
		expect(result.latencyMs).toEqual({ p50: 100, p95: 100, p99: 100, max: 100 });
		expect(fake.events.filter(event => event.startsWith("admit:"))).toHaveLength(15);
		expect(fake.events.at(-1)).toBe("close");
	});

	it("fails closed on unavailable observations after cleaning up", async function _UnavailableObservation()
	{
		const fake = _FakeSession(null);

		const result = await __QualifyDurableExecutionPickup(_Options, fake.runtime);

		expect(result.passed).toBe(false);
		expect(result.connectionEvidence).toEqual({ available: false });
		expect(fake.events.at(-1)).toBe("close");
	});

	it("cleans up after admission and timeout failures", async function _FailureCleanup()
	{
		const admission = _FakeSession();
		vi.spyOn(admission.session, "admit").mockRejectedValue(new Error("admission failed"));
		await expect(__QualifyDurableExecutionPickup(_Options, admission.runtime)).rejects.toThrow("admission failed");
		expect(admission.events.at(-1)).toBe("close");

		const timeout = _FakeSession();
		vi.spyOn(timeout.session, "admit").mockImplementation(async input => ({ taskId: `task-${input.sampleIndex}`, taskName: "qualification", idempotencyKey: `${input.sampleIndex}` }));
		timeout.runtime.withTimeout = async function _Timeout(): Promise<number> { throw new Error("pickup timed out"); };
		await expect(__QualifyDurableExecutionPickup(_Options, timeout.runtime)).rejects.toThrow("pickup timed out");
		expect(timeout.events.at(-1)).toBe("close");
	});
});

describe("durable execution qualification session", function _SessionSuite()
{
	it("owns admission and ordered cleanup without a live database", async function _Lifecycle()
	{
		const events: string[] = [];
		let definition: DurableTaskDefinition<_DurableExecutionQualificationInput, null> | undefined;
		const resources = {
			databasePool: { async query() { return { rows: [{ connection_count: "3" }] }; }, async end() { events.push("pool-end"); } } as unknown as Pool,
				execution: {
					register(value: DurableTaskDefinition<_DurableExecutionQualificationInput, null>) { definition = value; events.push("register"); },
					async startWorkers() { events.push("worker-start"); return { workerId: "worker", workerName: "worker", async drain() { events.push("worker-drain"); }, async stop() {} }; },
					async spawn(_transaction: DurableExecutionTransaction, input: { input: _DurableExecutionQualificationInput }) { events.push("spawn"); return { taskId: "task", taskName: "qualification", idempotencyKey: `${input.input.sampleIndex}` }; },
				} as unknown as AbsurdDurableExecution,
			queueOwner: { async createQueue() { events.push("queue-create"); }, async dropQueue() { events.push("queue-drop"); }, async close() { events.push("queue-close"); } } as unknown as Absurd,
			unitOfWork: { async admit<TResult>(operation: (transaction: DurableExecutionTransaction) => Promise<TResult>): Promise<TResult> { events.push("transaction"); return await operation({ client: {} }); }, async close() { events.push("uow-close"); } } satisfies DurableQualificationUnitOfWork,
		};
		const session = new _AbsurdDurableExecutionQualificationSession({ applicationName: "d2", databasePoolSize: 2, databaseUrl: _Options.databaseUrl, pollIntervalMs: 50, queueName: "queue", runId: "run", siloId: "testlynn" }, resources);
		const started: number[] = [];

		await session.start(input => started.push(input.sampleIndex));
		await definition?.run({} as never, { sampleIndex: 1, siloId: "testlynn" });
		await session.admit({ sampleIndex: 1, siloId: "testlynn" });
		expect(await session.connectionCount()).toBe(3);
		await session.close();

		expect(started).toEqual([1]);
		expect(events).toEqual(["queue-create", "register", "worker-start", "transaction", "spawn", "worker-drain", "queue-drop", "queue-close", "uow-close", "pool-end"]);
	});

	it("continues releasing later resources when one cleanup step fails", async function _CleanupFailure()
	{
		const events: string[] = [];
		const resources = {
			databasePool: { async end() { events.push("pool-end"); } } as unknown as Pool,
			execution: { register() {}, async startWorkers() { return { workerId: "worker", workerName: "worker", async drain() { events.push("worker-drain"); throw new Error("drain failed"); }, async stop() {} }; } } as unknown as AbsurdDurableExecution,
			queueOwner: { async createQueue() {}, async dropQueue() { events.push("queue-drop"); }, async close() { events.push("queue-close"); } } as unknown as Absurd,
			unitOfWork: { async admit<TResult>(_operation: (transaction: DurableExecutionTransaction) => Promise<TResult>): Promise<TResult> { throw new Error("unused"); }, async close() { events.push("uow-close"); } } satisfies DurableQualificationUnitOfWork,
		};
		const session = new _AbsurdDurableExecutionQualificationSession({ applicationName: "d2", databasePoolSize: 2, databaseUrl: _Options.databaseUrl, pollIntervalMs: 50, queueName: "queue", runId: "run", siloId: "testlynn" }, resources);
		await session.start(function _Started(): void {});

		await expect(session.close()).rejects.toThrow("could not remove its queue");

		expect(events).toEqual(["worker-drain", "queue-drop", "queue-close", "uow-close", "pool-end"]);
	});
});
