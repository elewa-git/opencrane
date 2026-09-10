import { TimeoutError, type TaskContext } from "absurd-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowError } from "@opencrane/backend/server/infra/workflows/contract";

import { _AbsurdTaskContext } from "../absurd-task-context";

const _TASK = { taskId: "task-1", taskName: "approval", idempotencyKey: "approval-1" } as const;

/** Creates the adapter around the one SDK method exercised by these tests. */
function _Context(awaitEvent: ReturnType<typeof vi.fn>): _AbsurdTaskContext
{
	return new _AbsurdTaskContext({ awaitEvent } as unknown as TaskContext, _TASK, 1, {} as never);
}

describe("Absurd task event waits", function _Suite()
{
	afterEach(function _RestoreClock()
	{
		vi.useRealTimers();
	});

	it("returns a delivered event without adding a timeout", async function _Delivered()
	{
		const awaitEvent = vi.fn().mockResolvedValue({ approved: true });
		await expect(_Context(awaitEvent).waitForEvent("tool-approval:invoke-1")).resolves.toEqual({ eventName: "tool-approval:invoke-1", payload: { approved: true } });
		expect(awaitEvent).toHaveBeenCalledExactlyOnceWith("opencrane-task:task-1:event:tool-approval:invoke-1", undefined);
	});

	it("rounds a future absolute deadline up to the SDK timeout in seconds", async function _FutureDeadline()
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
		const awaitEvent = vi.fn().mockResolvedValue("approved");
		await _Context(awaitEvent).waitForEvent("approval", { timeoutAt: new Date("2026-09-10T10:00:01.001Z") });
		expect(awaitEvent).toHaveBeenCalledExactlyOnceWith("opencrane-task:task-1:event:approval", { timeout: 2 });
	});

	it("projects the pinned SDK timeout without an application payload", async function _Timeout()
	{
		const awaitEvent = vi.fn().mockRejectedValue(new TimeoutError("event wait expired"));
		await expect(_Context(awaitEvent).waitForEvent("approval")).resolves.toEqual({ eventName: "approval", payload: null, timedOut: true });
	});

	it.each([new Date("invalid"), new Date("2026-09-10T09:59:59.999Z")])("rejects invalid or past deadlines before calling the SDK", async function _InvalidDeadline(timeoutAt)
	{
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-10T10:00:00.000Z"));
		const awaitEvent = vi.fn();
		await expect(_Context(awaitEvent).waitForEvent("approval", { timeoutAt })).rejects.toBeInstanceOf(WorkflowError);
		expect(awaitEvent).not.toHaveBeenCalled();
	});
});
