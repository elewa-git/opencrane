import { Injectable, signal } from "@angular/core";

import { MockScheduledTask } from "./mock-clock.types.js";

/** Fixed initial mock time used by screenshots and generated metadata. */
const MOCK_EPOCH_MS = Date.UTC(2026, 6, 14, 9, 0, 0);

/** Deterministic clock for mock IDs, timestamps, progress, and stream sequencing. */
@Injectable()
export class MockClockService
{
	/** Mutable current time expressed as epoch milliseconds. */
	private readonly _now = signal<number>(MOCK_EPOCH_MS);

	/** Pending deterministic tasks ordered by due time and task identifier. */
	private readonly _tasks = new Map<number, MockScheduledTask>();

	/** Monotonic task identifier counter. */
	private _taskSequence = 0;

	/** Monotonic entity identifier counter. */
	private _entitySequence = 0;

	/** Read-only deterministic current time. */
	public readonly now = this._now.asReadonly();

	/** Queues a callback without using wall-clock timers. */
	public schedule(callback: () => void, delayMilliseconds: number): number
	{
		this._taskSequence += 1;
		const task: MockScheduledTask =
		{
			id: this._taskSequence,
			dueAt: this._now() + Math.max(0, delayMilliseconds),
			callback
		};
		this._tasks.set(task.id, task);
		return task.id;
	}

	/** Removes one pending deterministic task. */
	public cancel(taskId: number): void
	{
		this._tasks.delete(taskId);
	}

	/** Returns a stable unique identifier within the current reset boundary. */
	public nextId(prefix: string): string
	{
		this._entitySequence += 1;
		return `${prefix}-${this._entitySequence}`;
	}

	/** Advances mock time without scheduling a real timer. */
	public advance(milliseconds: number): void
	{
		// 1. Advance deterministic time so every due callback observes the same target instant.
		this._now.update(function _advance(value: number): number
		{
			return value + Math.max(0, milliseconds);
		});

		// 2. Order due work explicitly so equal-time tasks remain repeatable across runtimes.
		const dueTasks = [...this._tasks.values()]
			.filter(function _Due(this: MockClockService, task: MockScheduledTask): boolean { return task.dueAt <= this._now(); }.bind(this))
			.sort(function _ByDueTime(left: MockScheduledTask, right: MockScheduledTask): number { return left.dueAt - right.dueAt || left.id - right.id; });

		// 3. Remove before execution so callbacks can safely schedule or cancel follow-up work.
		dueTasks.forEach(function _Run(this: MockClockService, task: MockScheduledTask): void
		{
			this._tasks.delete(task.id);
			task.callback();
		}.bind(this));
	}

	/** Restores the initial deterministic time. */
	public reset(): void
	{
		this._now.set(MOCK_EPOCH_MS);
		this._tasks.clear();
		this._taskSequence = 0;
		this._entitySequence = 0;
	}
}
