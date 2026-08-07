import { describe, expect, it, vi } from "vitest";

import { RunAdmissionConcurrencyDenialReasons, RunAdmissionConcurrencyGate } from "@opencrane/backend/agents/execution/runs";

import { _CreateRunAdmissionCapacityGate } from "../managed-run-admission.js";
import { __CreatePersonalRunAdmissionPortWithGate } from "../personal-run-admission.js";
import { PersonalRunAdmissionOutcomes, PersonalRunIdempotencyOutcomes, type PersonalRunAdmissionDependencies } from "../personal-run-admission.types.js";

/** Builds the only server-derived command the transport-free personal admission port accepts. */
function _Command(): Parameters<ReturnType<typeof __CreatePersonalRunAdmissionPortWithGate>["admitPersonalRun"]>[0]
{
	return { siloId: "silo-1", executionSubjectId: "user-1", threadId: "thread-1", requestIdempotencyKey: "request-1" };
}

/** Builds a default dependency set and lets each test replace one authority seam. */
function _Dependencies(overrides: Partial<PersonalRunAdmissionDependencies> = {}): PersonalRunAdmissionDependencies
{
	return {
		repository: { resolve: vi.fn(async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const; }), resolveThread: vi.fn(async function _resolveThread() { return { agentServiceId: "service-1" }; }) },
		assemble: vi.fn(async function _assemble() { return { outcome: "accepted", admissionOutcome: "accepted", snapshot: { runId: "run-1" } } as never; }),
		capacityGate: new RunAdmissionConcurrencyGate({ maxConcurrentAdmissions: 2, maxQueuedAdmissions: 0 }),
		...overrides,
	};
}

describe("personal run admission", function _describePersonalRunAdmission()
{
	it("returns an original snapshot before a later thread change is consulted", async function _returnsDurableDuplicateFirst()
	{
		const repository = { resolve: vi.fn(async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: "original-run" } as const; }), resolveThread: vi.fn(async function _resolveThread() { return null; }) };
		const assemble = vi.fn();
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({
			repository,
			assemble,
		}));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Idempotent, runId: "original-run" });
		expect(repository.resolveThread).not.toHaveBeenCalled();
		expect(assemble).not.toHaveBeenCalled();
	});

	it("denies a cross-silo or nonparticipant thread without assembling a snapshot", async function _deniesUnavailableThread()
	{
		const assemble = vi.fn();
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ repository: { resolve: async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const; }, resolveThread: async function _resolveThread() { return null; } }, assemble }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: "thread_unavailable" });
		expect(assemble).not.toHaveBeenCalled();
	});

	it("does not consult duplicate or thread Prisma authorities before the bounded preflight lane grants capacity", async function _boundsPreflightReads()
	{
		let release: (() => void) | undefined;
		const held = new Promise<void>(function _hold(resolve) { release = resolve; });
		const capacityGate = _CreateRunAdmissionCapacityGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 0 });
		const activePreflight = capacityGate.execute({ siloId: "silo-1", agentServiceId: "__personal_admission_preflight__" }, async function _holdPreflight() { await held; return "held"; });
		const repository = { resolve: vi.fn(async function _resolve() { return { outcome: PersonalRunIdempotencyOutcomes.NotFound } as const; }), resolveThread: vi.fn(async function _resolveThread() { return { agentServiceId: "service-1" }; }) };
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ capacityGate, repository }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited });
		expect(repository.resolve).not.toHaveBeenCalled();
		expect(repository.resolveThread).not.toHaveBeenCalled();
		release?.();
		await expect(activePreflight).resolves.toEqual({ outcome: "completed", value: "held" });
	});

	it("uses the same shared capacity gate that protects managed admissions", async function _sharesCapacity()
	{
		let release: (() => void) | undefined;
		const held = new Promise<void>(function _hold(resolve) { release = resolve; });
		const capacityGate = _CreateRunAdmissionCapacityGate({ maxConcurrentAdmissions: 1, maxQueuedAdmissions: 0 });
		const first = capacityGate.execute({ siloId: "silo-1", agentServiceId: "managed-service" }, async function _holdManagedAdmission() { await held; return "held"; });
		const port = __CreatePersonalRunAdmissionPortWithGate(_Dependencies({ capacityGate }));

		await expect(port.admitPersonalRun(_Command())).resolves.toEqual({ outcome: PersonalRunAdmissionOutcomes.Denied, reason: RunAdmissionConcurrencyDenialReasons.AdmissionConcurrencyLimited });
		release?.();
		await expect(first).resolves.toEqual({ outcome: "completed", value: "held" });
	});
});
