import { describe, expect, it, vi } from "vitest";

import { RunAdmissionConcurrencyGate } from "@opencrane/backend/agents/execution/runs";
import type { ManagedRunNowCommand } from "@opencrane/backend/server/agents/agent-services";

import { __CreateRunAdmissionCapacityGate, _CreateManagedRunAdmissionPortWithGate, _ReadRunAdmissionConcurrencyPolicy } from "../run-admission-wiring.js";

/** Produce one valid managed admission command, varying only the authority coordinates under test. */
function _Command(agentServiceId: string, siloId = "silo-a"): ManagedRunNowCommand
{
	return { agentServiceId, siloId, requestedBy: "user-a", requestIdempotencyKey: `${siloId}:${agentServiceId}`, trigger: "managed_invocation", scheduledSlot: null };
}

describe("managed run admission composition", function _describeManagedRunAdmissionComposition()
{
	it("rejects an overloaded service before it starts another persistence admission", async function _rejectsBeforePersistence()
	{
		let release: (() => void) | undefined;
		const held = new Promise<void>(function _hold(resolve) { release = resolve; });
		const admit = vi.fn(async function _admit()
		{
			await held;
			return { outcome: "denied", reason: "run_admission_unavailable" } as const;
		});
		const port = _CreateManagedRunAdmissionPortWithGate({ admit } as never, new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 0 }));

		const first = port.admitManagedRun(_Command("service-a"));
		await vi.waitFor(function _waitForFirstAdmission() { expect(admit).toHaveBeenCalledTimes(1); });
		await expect(port.admitManagedRun(_Command("service-a"))).resolves.toEqual({ outcome: "denied", reason: "admission_concurrency_limited" });
		expect(admit).toHaveBeenCalledTimes(1);
		release?.();
		await expect(first).resolves.toEqual({ outcome: "denied", reason: "run_admission_unavailable" });
	});

	it("bounds different services below the process database budget", async function _boundsProcessCapacity()
	{
		let release: (() => void) | undefined;
		const held = new Promise<void>(function _hold(resolve) { release = resolve; });
		const admit = vi.fn(async function _admit()
		{
			await held;
			return { outcome: "denied", reason: "run_admission_unavailable" } as const;
		});
		const port = _CreateManagedRunAdmissionPortWithGate({ admit } as never, __CreateRunAdmissionCapacityGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 0 }));

		const first = port.admitManagedRun(_Command("service-a", "silo-a"));
		const second = port.admitManagedRun(_Command("service-a", "silo-b"));
		await vi.waitFor(function _waitForProcessCapacity() { expect(admit).toHaveBeenCalledTimes(2); });
		await expect(port.admitManagedRun(_Command("service-b", "silo-c"))).resolves.toEqual({ outcome: "denied", reason: "admission_concurrency_limited" });
		release?.();
		await expect(Promise.all([first, second])).resolves.toEqual([
			{ outcome: "denied", reason: "run_admission_unavailable" },
			{ outcome: "denied", reason: "run_admission_unavailable" },
		]);
	});

	it("reads only bounded server-owned capacity settings", function _readsBoundedSettings()
	{
		expect(_ReadRunAdmissionConcurrencyPolicy({ AGENT_RUN_ADMISSION_MAX_CONCURRENT: "2", AGENT_RUN_ADMISSION_MAX_QUEUED: "20" })).toEqual({ maxConcurrentAdmissions: 2, maxQueuedAdmissions: 20 });
		expect(function _rejectsOversizedActiveLimit() { _ReadRunAdmissionConcurrencyPolicy({ AGENT_RUN_ADMISSION_MAX_CONCURRENT: "3" }); }).toThrow("AGENT_RUN_ADMISSION_MAX_CONCURRENT must be an integer from 1 through 2");
	});
});
