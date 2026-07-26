import type { RunAdmissionCommand } from "./run-admission.types.js";
import type { RunAdmissionConcurrencyPolicy, RunAdmissionConcurrencyResult } from "./run-admission-concurrency.types.js";

/** Bounds admission work by silo and service before a caller can take a PostgreSQL connection. */
export class RunAdmissionConcurrencyGate
{
	/** Immutable capacity policy applied to every independent silo/service queue. */
	private readonly policy: RunAdmissionConcurrencyPolicy;
	/** Active and waiting admissions indexed by a non-user-visible authority key. */
	private readonly queues = new Map<string, _AdmissionQueue>();

	/**
	 * Creates an in-process admission gate for the server process that owns admission.
	 * @param policy - Per-service active and waiting capacity limits.
	 */
	constructor(policy: RunAdmissionConcurrencyPolicy)
	{
		if (!_isPositiveInteger(policy.maxConcurrentAdmissions)) throw new Error("maxConcurrentAdmissions must be a positive integer");
		if (!_isNonNegativeInteger(policy.maxQueuedAdmissions)) throw new Error("maxQueuedAdmissions must be a non-negative integer");
		this.policy = policy;
	}

	/**
	 * Runs work after one bounded service slot is available, or rejects before the caller can begin persistence.
	 * @param command - Immutable admission coordinates used only to partition capacity.
	 * @param work - Admission assembly and persistence work that may acquire a database connection only after a slot is granted.
	 * @returns The completed value or a fail-closed overload rejection.
	 */
	async execute<TResult>(command: Pick<RunAdmissionCommand, "siloId" | "agentServiceId">, work: () => Promise<TResult>): Promise<RunAdmissionConcurrencyResult<TResult>>
	{
		const key = _queueKey(command);
		const queue = this.queues.get(key) ?? { active: 0, waiting: [] };
		this.queues.set(key, queue);

		// 1. Start immediately only while this service has capacity, so excess callers never reach Postgres.
		if (queue.active < this.policy.maxConcurrentAdmissions)
		{
			return await this._executeActive(key, queue, work);
		}

		// 2. Bound waiting work in memory so an overloaded service cannot turn into an unbounded process queue.
		if (queue.waiting.length >= this.policy.maxQueuedAdmissions)
		{
			return { outcome: "rejected", reason: "admission_concurrency_limited" };
		}

		// 3. Preserve FIFO order while waiting outside the database pool, then run exactly one released admission.
		const gate = this;
		return await new Promise<RunAdmissionConcurrencyResult<TResult>>(function _waitForAdmission(resolve, reject)
		{
			queue.waiting.push({ start: function _startWaitingAdmission(): void
			{
				void gate._executeActive(key, queue, work).then(resolve, reject);
			} });
		});
	}

	/** Runs one active admission and releases the next FIFO waiter after its work settles. */
	private async _executeActive<TResult>(key: string, queue: _AdmissionQueue, work: () => Promise<TResult>): Promise<RunAdmissionConcurrencyResult<TResult>>
	{
		queue.active += 1;
		try
		{
			return { outcome: "completed", value: await work() };
		}
		finally
		{
			queue.active -= 1;
			this._startNext(key, queue);
		}
	}

	/** Starts the next FIFO admission only after an active slot is released, then removes idle queue state. */
	private _startNext(key: string, queue: _AdmissionQueue): void
	{
		const next = queue.waiting.shift();
		if (next === undefined)
		{
			if (queue.active === 0) this.queues.delete(key);
			return;
		}

		next.start();
	}
}

/** One pending admission callback that has not yet entered the caller's persistence path. */
interface _AdmissionWaiter
{
	/** Starts the waiter with its original generic result type once the gate grants a capacity slot. */
	start(): void;
}

/** Mutable queue state isolated to one silo and AgentService. */
interface _AdmissionQueue
{
	/** Number of admissions currently allowed to execute for this authority key. */
	active: number;
	/** FIFO callers that have not yet begun persistence work. */
	waiting: _AdmissionWaiter[];
}

/** Derives an internal queue key that cannot collide between a silo or service boundary. */
function _queueKey(command: Pick<RunAdmissionCommand, "siloId" | "agentServiceId">): string
{
	return `${command.siloId}\u0000${command.agentServiceId}`;
}

/** Returns whether a capacity field is a safe positive whole number. */
function _isPositiveInteger(value: number): boolean
{
	return Number.isSafeInteger(value) && value > 0;
}

/** Returns whether a queue bound is a safe whole number, including an intentionally disabled queue. */
function _isNonNegativeInteger(value: number): boolean
{
	return Number.isSafeInteger(value) && value >= 0;
}
