import { describe, expect, it, vi } from "vitest";

import { RuntimeCommandWakeup } from "../runtime-command-wakeup.js";

describe("RuntimeCommandWakeup", function _describeRuntimeCommandWakeup()
{
	it("wakes an idle stream immediately after a newer lifecycle hint", async function _wakesPendingStream()
	{
		const wakeup = new RuntimeCommandWakeup();
		const waiting = wakeup.waitForChange(wakeup.currentRevision(), 30_000);
		wakeup.wake();
		await expect(waiting).resolves.toBeUndefined();
	});

	it("does not miss a hint that arrives between a durable read and waiter registration", async function _closesReadWaitRace()
	{
		const wakeup = new RuntimeCommandWakeup();
		const observed = wakeup.currentRevision();
		wakeup.wake();
		await expect(wakeup.waitForChange(observed, 30_000)).resolves.toBeUndefined();
	});

	it("falls back to the bounded recovery timer when no local hint arrives", async function _fallsBackToRecovery()
	{
		vi.useFakeTimers();
		try
		{
			const wakeup = new RuntimeCommandWakeup();
			const waiting = wakeup.waitForChange(wakeup.currentRevision(), 30_000);
			await vi.advanceTimersByTimeAsync(30_000);
			await expect(waiting).resolves.toBeUndefined();
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("releases an idle wait immediately when its stream closes", async function _releasesAbortedWait()
	{
		const wakeup = new RuntimeCommandWakeup();
		const controller = new AbortController();
		const waiting = wakeup.waitForChange(wakeup.currentRevision(), 30_000, controller.signal);
		controller.abort();
		await expect(waiting).resolves.toBeUndefined();
	});
});
