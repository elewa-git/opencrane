import { afterEach, describe, expect, it, vi } from "vitest";

import { _StartRuntimeRepair } from "../runtime-repair";

describe("shared runtime terminal repair", function _Suite()
{
	afterEach(function _RestoreTimers(): void
	{
		vi.useRealTimers();
	});

	it("checks on startup, repeats while active, and stops with the development lifecycle", async function _RepairLifecycle(): Promise<void>
	{
		vi.useFakeTimers();
		const repairNextExpiredRunAtomically = vi.fn().mockResolvedValue({ status: "none" });
		const repair = _StartRuntimeRepair({ repairNextExpiredRunAtomically }, true, 1_000);
		await vi.runOnlyPendingTimersAsync();

		expect(repairNextExpiredRunAtomically).toHaveBeenCalledTimes(2);
		repair.stop();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(repairNextExpiredRunAtomically).toHaveBeenCalledTimes(2);
	});
});
