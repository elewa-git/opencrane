import { AgentRevisionState, AgentRunState, AgentServiceState, RunOutboxEventKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaControllerAuthorityRepository } from "./prisma-controller-authority.js";

/** Creates the fixed server-owned runtime policy used by controller persistence tests. */
function _profiles(): ReadonlyMap<string, { readonly namespace: string; readonly serviceAccountName: string; readonly image: string; readonly assignmentTtlMs: number }>
{
	return new Map([["personal-default", { namespace: "agent-runtimes", serviceAccountName: "agent-runtime", image: `registry.example/runtime@sha256:${"a".repeat(64)}`, assignmentTtlMs: 120_000 }]]);
}

/** Builds the smallest durable event row accepted by the controller authority. */
function _event(claimedAt: Date | null = new Date(990_000))
{
	return { id: "event-1", runId: "run-1", attempt: 1, kind: RunOutboxEventKind.RunAttemptRequested, payload: { runId: "run-1", attempt: 1 }, availableAt: new Date(0), claimedAt, publishedAt: null, failedAt: null, deliveryCount: 0 };
}

/** Builds one current queued run for an acknowledged controller Job. */
function _run(state: AgentRunState = AgentRunState.Queued)
{
	return { id: "run-1", attempt: 1, state, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", executionSubjectId: "user-1" };
}

/** Builds active service authority for the current run revision. */
function _service()
{
	return { id: "service-1", siloId: "silo-1", state: AgentServiceState.Active, activeRevisionId: "revision-1", workloadProfile: "personal-default" };
}

/** Executes a controller transaction against a lightweight Prisma facade. */
function _repository(transaction: Record<string, unknown>): PrismaControllerAuthorityRepository
{
	const prisma = { $transaction: async function _transaction<T>(operation: (client: never) => Promise<T>): Promise<T> { return operation(transaction as never); } } as never;
	return new PrismaControllerAuthorityRepository(prisma, _profiles());
}

describe("Prisma controller authority adapter", function _suite()
{
	it("claims a durable event and derives desired coordinates solely from canonical rows", async function _claim()
	{
		const transaction = {
			outboxEvent: {
				findFirst: vi.fn().mockResolvedValue(_event(null)),
				findUnique: vi.fn().mockResolvedValue(_event(null)),
				update: vi.fn().mockResolvedValue({}),
			},
			$queryRaw: vi.fn().mockResolvedValue([{ id: "event-1" }]),
			agentRun: { findUnique: vi.fn().mockResolvedValue(_run(AgentRunState.Accepted)), update: vi.fn().mockResolvedValue({}) },
			agentService: { findUnique: vi.fn().mockResolvedValue(_service()) },
			agentRevision: { findUnique: vi.fn().mockResolvedValue({ id: "revision-1", state: AgentRevisionState.Published }) },
		};
		const desired = await _repository(transaction).claimDesiredJob(1_000_000);

		expect(desired).toEqual(expect.objectContaining({ runId: "run-1", attempt: 1, subjectId: "user-1", namespace: "agent-runtimes", serviceAccountName: "agent-runtime" }));
		expect(transaction.agentRun.update).toHaveBeenCalledWith({ where: { id: "run-1" }, data: { state: AgentRunState.Queued } });
		expect(transaction.outboxEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { claimedAt: new Date(1_000_000), deliveryCount: { increment: 1 } } }));
	});

	it("writes assignment and opaque bootstrap before assigning the run, but never unsuspends a Job", async function _acknowledge()
	{
		const assignmentCreate = vi.fn().mockResolvedValue({});
		const bootstrapCreate = vi.fn().mockResolvedValue({});
		const runUpdate = vi.fn().mockResolvedValue({});
		const eventUpdate = vi.fn().mockResolvedValue({});
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			outboxEvent: { findMany: vi.fn().mockResolvedValue([_event()]), update: eventUpdate },
			agentRun: { findUnique: vi.fn().mockResolvedValue(_run()), update: runUpdate },
			agentService: { findUnique: vi.fn().mockResolvedValue(_service()) },
			agentRevision: { findUnique: vi.fn().mockResolvedValue({ id: "revision-1", state: AgentRevisionState.Published }) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null), create: assignmentCreate },
			workloadBootstrap: { create: bootstrapCreate },
		};
		const result = await _repository(transaction).recordJob({ runId: "run-1", attempt: 1, workloadName: "agent-run-run-1-a2d003afd28962f6-a1", workloadUid: "job-uid-1" }, 1_000_000);

		expect(result).toEqual({ bootstrapReady: false });
		expect(assignmentCreate).toHaveBeenCalledBefore(bootstrapCreate);
		expect(bootstrapCreate).toHaveBeenCalledBefore(runUpdate);
		expect(runUpdate).toHaveBeenCalledBefore(eventUpdate);
		expect(assignmentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ workloadUid: "job-uid-1", audience: "opencrane" }) });
		expect(bootstrapCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ claimDigest: expect.stringMatching(/^sha256:/u) }) });
	});

	it("refuses a Pod acknowledgement that does not belong to the current assigned Job", async function _pod()
	{
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue({ workloadKind: "Job", workloadUid: "job-uid-other", podUid: null }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(_run(AgentRunState.Assigned)) },
		};

		await expect(_repository(transaction).recordPod({ runId: "run-1", attempt: 1, workloadName: "agent-run-run-1-a2d003afd28962f6-a1", workloadUid: "job-uid-1", podUid: "pod-uid-1" }, 1_000_000)).rejects.toThrow("pod does not belong");
	});

	it("rejects an acknowledgement whose name is not the server-derived Job name", async function _name()
	{
		const transaction = { $queryRaw: vi.fn() };

		await expect(_repository(transaction).recordJob({ runId: "run-1", attempt: 1, workloadName: "attacker-job", workloadUid: "job-uid-1" }, 1_000_000)).rejects.toThrow("unexpected deterministic Job name");
	});

	it("fails a queued run with its exhausted controller-delivery event", async function _exhausted()
	{
		const exhausted = { ..._event(new Date(900_000)), deliveryCount: 5 };
		const eventUpdate = vi.fn().mockResolvedValue({});
		const runUpdate = vi.fn().mockResolvedValue({});
		const transaction = {
			outboxEvent: { findFirst: vi.fn().mockResolvedValue(exhausted), findUnique: vi.fn().mockResolvedValue(exhausted), update: eventUpdate },
			$queryRaw: vi.fn().mockResolvedValue([]),
			agentRun: { findUnique: vi.fn().mockResolvedValue(_run()), update: runUpdate },
		};

		await expect(_repository(transaction).claimDesiredJob(1_000_000)).resolves.toBeNull();
		expect(runUpdate).toHaveBeenCalledWith({ where: { id: "run-1" }, data: { state: AgentRunState.Failed, finishedAt: new Date(1_000_000), terminalReason: "RuntimeFailure" } });
		expect(eventUpdate).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { failedAt: new Date(1_000_000), failureCode: "controller_delivery_exhausted" } });
	});

	it("rejects a stale acknowledgement lease before creating an assignment", async function _expiredLease()
	{
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			outboxEvent: { findMany: vi.fn().mockResolvedValue([_event(new Date(900_000))]) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(_run()) },
			agentService: { findUnique: vi.fn().mockResolvedValue(_service()) },
			agentRevision: { findUnique: vi.fn().mockResolvedValue({ id: "revision-1", state: AgentRevisionState.Published }) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
		};

		await expect(_repository(transaction).recordJob({ runId: "run-1", attempt: 1, workloadName: "agent-run-run-1-a2d003afd28962f6-a1", workloadUid: "job-uid-1" }, 1_000_000)).rejects.toThrow("lease expired");
	});
});
