import { describe, expect, it } from "vitest";

import { RunAdmissionConcurrencyGate } from "../run-admission-concurrency.js";

/** Creates fixed admission coordinates with optional silo and service overrides. */
function _command(siloId = "silo-1", agentServiceId = "service-1")
{
	return { siloId, agentServiceId } as const;
}

/** Deferred promise controls used to observe whether a queued admission has started. */
interface _Deferred<TValue>
{
	/** Promise settled only by this test's explicit resolve or reject function. */
	readonly promise: Promise<TValue>;
	/** Completes the controlled promise with one value. */
	resolve(value: TValue): void;
}

/** Creates a deferred value without exposing a database or timer dependency to the concurrency test. */
function _deferred<TValue>(): _Deferred<TValue>
{
	let resolve: ((value: TValue) => void) | undefined;
	const promise = new Promise<TValue>(function _createDeferred(nextResolve)
	{
		resolve = nextResolve;
	});
	return { promise, resolve: function _resolve(value: TValue): void { resolve?.(value); } };
}

describe("RunAdmissionConcurrencyGate", function _describeRunAdmissionConcurrencyGate()
{
	it("queues one same-service admission before persistence and rejects later overload without running it", async function _boundsOneService()
	{
		const gate = new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 1 });
		const first = _deferred<string>();
		const second = _deferred<string>();
		let firstStarted = false;
		let secondStarted = false;
		let rejectedStarted = false;

		const firstResult = gate.execute(_command(), async function _runFirst() { firstStarted = true; return await first.promise; });
		const secondResult = gate.execute(_command(), async function _runSecond() { secondStarted = true; return await second.promise; });
		const rejectedResult = gate.execute(_command(), async function _runRejected() { rejectedStarted = true; return "must-not-run"; });

		expect(firstStarted).toBe(true);
		expect(secondStarted).toBe(false);
		await expect(rejectedResult).resolves.toEqual({ outcome: "rejected", reason: "admission_concurrency_limited" });
		expect(rejectedStarted).toBe(false);

		first.resolve("first");
		await expect(firstResult).resolves.toEqual({ outcome: "completed", value: "first" });
		expect(secondStarted).toBe(true);
		second.resolve("second");
		await expect(secondResult).resolves.toEqual({ outcome: "completed", value: "second" });
	});

	it("does not let one service consume another service or silo's admission capacity", async function _partitionsAuthority()
	{
		const gate = new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 0 });
		const first = _deferred<string>();
		const second = _deferred<string>();
		const third = _deferred<string>();
		let starts = 0;

		const firstResult = gate.execute(_command("silo-1", "service-1"), async function _runFirst() { starts += 1; return await first.promise; });
		const secondResult = gate.execute(_command("silo-1", "service-2"), async function _runSecond() { starts += 1; return await second.promise; });
		const thirdResult = gate.execute(_command("silo-2", "service-1"), async function _runThird() { starts += 1; return await third.promise; });

		expect(starts).toBe(3);
		first.resolve("first");
		second.resolve("second");
		third.resolve("third");
		await expect(Promise.all([firstResult, secondResult, thirdResult])).resolves.toEqual([
			{ outcome: "completed", value: "first" },
			{ outcome: "completed", value: "second" },
			{ outcome: "completed", value: "third" },
		]);
	});

	it("releases the next waiter when active admission work fails", async function _releasesAfterFailure()
	{
		const gate = new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 1 });
		const first = _deferred<void>();
		let secondStarted = false;
		const firstResult = gate.execute(_command(), async function _runFirst() { await first.promise; throw new Error("persistence unavailable"); });
		const secondResult = gate.execute(_command(), async function _runSecond() { secondStarted = true; return "second"; });

		first.resolve();
		await expect(firstResult).rejects.toThrow("persistence unavailable");
		await expect(secondResult).resolves.toEqual({ outcome: "completed", value: "second" });
		expect(secondStarted).toBe(true);
	});

	it("rejects invalid capacity policies before accepting any admission", function _rejectsInvalidPolicy()
	{
		expect(function _invalidConcurrent() { return new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 0, maxQueuedAdmissions: 1 }); }).toThrow("maxConcurrentAdmissions must be a positive integer");
		expect(function _invalidQueue() { return new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: -1 }); }).toThrow("maxQueuedAdmissions must be a non-negative integer");
	});
});
