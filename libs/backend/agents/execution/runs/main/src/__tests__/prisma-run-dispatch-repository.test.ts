import { createHash } from "node:crypto";

import { AgentRunState, AgentRunTerminalReason, AgentServiceKind, AgentServiceState, RunOutboxEventKind, WorkloadAssignmentState, WorkloadKind, type PrismaClient } from "@prisma/client";
import { ___GetContext } from "@opencrane/observability";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunDispatchRepository } from "../prisma-run-dispatch-repository.js";
import type { AttemptModelKeyIssuer, AttemptModelKeyMintRequest, MintedAttemptModelKey } from "../run-dispatch.types.js";

/** A recording attempt-key issuer; non-claim tests never reach minting so its key is unused there. */
function _Issuer(record?: (request: AttemptModelKeyMintRequest) => void): AttemptModelKeyIssuer
{
	return async function _issue(request: AttemptModelKeyMintRequest): Promise<MintedAttemptModelKey>
	{
		if (record) record(request);
		return { key: "sk-attempt-transient" };
	};
}

/** Creates one dispatchable personal-agent run. */
function _Run()
{
	return { id: "run-1", attempt: 1, state: AgentRunState.Accepted, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", effectiveContractDigest: "sha256:contract", threadId: "thread-1" };
}

/** Creates the active service authority pinned by the run. */
function _Service()
{
	return { id: "service-1", siloId: "silo-1", kind: AgentServiceKind.Personal, state: AgentServiceState.Active, activeRevisionId: "revision-1", workloadProfile: "personal-small" };
}

/** Creates the pending dispatch event. */
function _Event(overrides: Record<string, unknown> = {})
{
	return { id: "event-1", runId: "run-1", attempt: 1, kind: RunOutboxEventKind.RunAttemptRequested, availableAt: new Date("2026-07-20T00:00:00.000Z"), claimedAt: null, publishedAt: null, failedAt: null, deliveryCount: 0, ...overrides };
}

/** Creates the immutable input snapshot and its time-bounded signed membership identity. */
function _Snapshot(trustedUntil = "2026-07-20T02:00:00.000Z")
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", effectiveContractDigest: "sha256:contract", digest: "sha256:snapshot", threadId: "thread-1", modelRoute: { alias: "silo-default" }, budgetPolicy: { maxCostUsdMicros: 5_000_000 }, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipTrustedUntil: trustedUntil } };
}

/** Creates the exact suspended-Job assignment command returned after a claim. */
function _Command()
{
	return { runId: "run-1", attempt: 1, claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expectedWorkloadProfile: "personal-small", bootstrapReference: "bootstrap-v1_430e1162a31b3b4c29ed8b60c2a419df262a483fc4d759d001ed3b4949dc16e8", namespace: "silo-a", serviceAccountName: "agent-runtime-small", workloadUid: "job-uid-1" } as const;
}

/** Creates the immutable PendingPod assignment produced by assignment commit. */
function _Assignment(overrides: Record<string, unknown> = {})
{
	return { runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", subjectId: "user-1", audience: "opencrane-agent-runtime", serviceAccountName: "agent-runtime-small", namespace: "silo-a", workloadKind: WorkloadKind.Job, workloadUid: "job-uid-1", workloadProfile: "personal-small", podUid: null, state: WorkloadAssignmentState.PendingPod, expiresAt: new Date("2026-07-20T01:00:10.000Z"), createdAt: new Date("2026-07-20T00:00:10.000Z"), registeredAt: null, revokedAt: null, ...overrides };
}

/** Creates the integrity row for the committed assignment. */
function _Bootstrap(overrides: Record<string, unknown> = {})
{
	return { id: _Command().bootstrapReference, runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", subjectId: "user-1", audience: "opencrane-agent-runtime", serviceAccountName: "agent-runtime-small", namespace: "silo-a", workloadKind: WorkloadKind.Job, workloadUid: "job-uid-1", claimDigest: "sha256:b5a2a30dadd6b5f535e1a46bb5953096ad9c2a9a4e87f04e69cfbf8aacff361e", expiresAt: new Date("2026-07-20T01:00:10.000Z"), consumedAt: null, consumedByPodUid: null, receiptId: null, createdAt: new Date("2026-07-20T00:00:10.000Z"), ...overrides };
}

/** Compute the integrity digest needed by a valid alternate-run bootstrap fixture. */
function _BootstrapDigest(reference: string, assignment: ReturnType<typeof _Assignment>): string
{
	const canonical = JSON.stringify(["opencrane-workload-bootstrap-integrity-v1", reference, assignment.runId, assignment.attempt, assignment.agentServiceId, assignment.agentRevisionId, assignment.siloId, assignment.subjectId, assignment.audience, assignment.serviceAccountName, assignment.namespace, assignment.workloadKind, assignment.workloadUid, assignment.workloadProfile, assignment.expiresAt.toISOString(), assignment.createdAt.toISOString()]);
	return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** Creates the durable release event generated by assignment commit. */
function _ReleaseEvent(overrides: Record<string, unknown> = {})
{
	return { id: "release-1", runId: "run-1", attempt: 1, sequence: 3, kind: RunOutboxEventKind.RunWorkloadReleaseRequested, idempotencyKey: "run-1:attempt:1:workload-release", payload: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-a", serviceAccountName: "agent-runtime-small", workloadUid: "job-uid-1", workloadProfile: "personal-small", assignmentExpiresAt: "2026-07-20T01:00:10.000Z", bootstrapReference: _Command().bootstrapReference }, availableAt: new Date("2026-07-20T00:00:10.000Z"), claimedAt: null, publishedAt: null, failedAt: null, failureCode: null, deliveryCount: 0, createdAt: new Date("2026-07-20T00:00:10.000Z"), ...overrides };
}

/** Creates exact first-Pod registration evidence for the release claim. */
function _Registration()
{
	return { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", claimedAt: "2026-07-20T00:20:00.000Z", deliveryCount: 1, namespace: "silo-a", serviceAccountName: "agent-runtime-small", workloadUid: "job-uid-1", workloadProfile: "personal-small", bootstrapReference: _Command().bootstrapReference, podUid: "pod-uid-1" } as const;
}

/** Read the SQL text carried by a Prisma tagged query. */
function _SqlText(value: unknown): string
{
	return ((value as { strings?: readonly string[] }).strings ?? []).join(" ");
}

/** Creates a lock-query mock that returns database time only for the clock query. */
function _RegistrationQueryRaw(now: Date)
{
	return vi.fn(async function _Query(value: unknown)
	{
		return _SqlText(value).includes("clock_timestamp()::timestamp(3)") ? [{ now }] : [];
	});
}

describe("PrismaRunDispatchRepository", function _DescribeDispatchRepository()
{
	it("claims under service-run-outbox lock order and returns only the narrow projection", async function _Claim()
	{
		const run = _Run();
		const event = _Event();
		const queryRaw = vi.fn()
			.mockResolvedValueOnce([{ eventId: event.id, runId: run.id, agentServiceId: run.agentServiceId }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:00.000Z") }]);
		const transaction = {
			$queryRaw: queryRaw,
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 2 } }), create: vi.fn().mockResolvedValue(_ReleaseEvent()) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot()) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		const result = await repository.claimNextAttemptAtomically();
		expect(result).toEqual({
			status: "claimed",
			claim: {
				lease: { eventId: "event-1", claimedAt: "2026-07-20T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-07-20T00:00:30.000Z" },
				attempt: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", inputSnapshotDigest: "sha256:snapshot", namespace: "silo-a", workloadProfile: "personal-small", bootstrapReference: _Command().bootstrapReference, litellmKey: "sk-attempt-transient" },
			},
		});
		expect(_SqlText(queryRaw.mock.calls[1]?.[0])).toContain("agent_services");
		expect(_SqlText(queryRaw.mock.calls[2]?.[0])).toContain("pg_advisory_xact_lock");
		expect(_SqlText(queryRaw.mock.calls[3]?.[0])).toContain("agent_runs");
		expect(_SqlText(queryRaw.mock.calls[4]?.[0])).toContain("run_outbox_events");
		expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "event-1", deliveryCount: 0 }), data: { claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1 } });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ state: AgentRunState.Accepted }), data: { state: AgentRunState.Queued } });
		expect(JSON.stringify(result)).not.toContain("executionSubjectId");
	});

	it("mints the attempt key onto the claim response without persisting it to Postgres", async function _MintsTransientKey()
	{
		const run = _Run();
		const event = _Event();
		const queryRaw = vi.fn()
			.mockResolvedValueOnce([{ eventId: event.id, runId: run.id, agentServiceId: run.agentServiceId }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:00.000Z") }]);
		const writes: unknown[] = [];
		const transaction = {
			$queryRaw: queryRaw,
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn(async function _runUpdate(args: unknown) { writes.push(args); return { count: 1 }; }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn(async function _eventUpdate(args: unknown) { writes.push(args); return { count: 1 }; }) },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot()) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const requests: AttemptModelKeyMintRequest[] = [];
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer(function _record(request: AttemptModelKeyMintRequest) { requests.push(request); }));

		const result = await repository.claimNextAttemptAtomically();

		// The issuer is called with the frozen alias, budget, and expiry; minting happens after the
		// transaction so no external call holds a lock.
		expect(requests).toEqual([{ keyAlias: expect.stringMatching(/^attempt-[0-9a-f]{32}$/), modelAlias: "silo-default", siloId: "silo-1", maxBudgetUsd: 5, expirySeconds: 3_600 }]);
		expect(result).toMatchObject({ status: "claimed", claim: { attempt: { litellmKey: "sk-attempt-transient" } } });
		// The transient key rides the claim response only; it appears in no database write argument.
		expect(JSON.stringify(writes)).not.toContain("sk-attempt-transient");
	});

	it("terminalises an expired first event so the next valid attempt can be claimed", async function _SkipsPoisonedHead()
	{
		const firstRun = _Run();
		const firstEvent = _Event();
		const firstTransaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([{ eventId: firstEvent.id, runId: firstRun.id, agentServiceId: firstRun.agentServiceId }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:00.000Z") }]),
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(firstRun), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(firstEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), create: vi.fn().mockResolvedValue({}) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot("2026-07-20T00:00:00.000Z")) },
		};
		const secondRun = { ..._Run(), id: "run-2", agentServiceId: "service-2", agentRevisionId: "revision-2", inputSnapshotDigest: "sha256:snapshot-2" };
		const secondService = { ..._Service(), id: "service-2", activeRevisionId: "revision-2" };
		const secondEvent = _Event({ id: "event-2", runId: "run-2" });
		const secondSnapshot = { ..._Snapshot(), runId: "run-2", agentServiceId: "service-2", agentRevisionId: "revision-2", digest: "sha256:snapshot-2" };
		const secondTransaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([{ eventId: secondEvent.id, runId: secondRun.id, agentServiceId: secondRun.agentServiceId }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:01.000Z") }]),
			agentService: { findUnique: vi.fn().mockResolvedValue(secondService) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(secondRun), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(secondEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationRunEvent: { aggregate: vi.fn(), create: vi.fn() },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null) },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(secondSnapshot) },
		};
		const transactions = [firstTransaction, secondTransaction];
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof firstTransaction) => Promise<unknown>) { return callback(transactions.shift()!); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.claimNextAttemptAtomically()).resolves.toEqual({ status: "none" });
		expect(firstTransaction.outboxEvent.updateMany).toHaveBeenCalledWith({ where: { id: "event-1", claimedAt: null, deliveryCount: 0, publishedAt: null, failedAt: null }, data: { claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1, failedAt: new Date("2026-07-20T00:00:00.000Z"), failureCode: "RUN_DISPATCH_MEMBERSHIP_EXPIRED" } });
		expect(firstTransaction.agentRun.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "run-1" }), data: expect.objectContaining({ state: AgentRunState.Failed }) });
		expect(firstTransaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: { runId: "run-1", sequence: 5, type: "run.failed", payload: { terminalReason: "policy_denied", failureCode: "RUN_DISPATCH_MEMBERSHIP_EXPIRED" }, occurredAt: new Date("2026-07-20T00:00:00.000Z") } });
		await expect(repository.claimNextAttemptAtomically()).resolves.toMatchObject({ status: "claimed", claim: { lease: { eventId: "event-2" }, attempt: { runId: "run-2" } } });
	});

	it("rejects a stale claimant before writing an assignment", async function _RejectStaleClaim()
	{
		const run = { ..._Run(), state: AgentRunState.Queued };
		const event = _Event({ claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1 });
		const queryRaw = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:30.000Z") }]);
		const transaction = {
			$queryRaw: queryRaw,
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn() },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn() },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot()) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.commitSuspendedJobAssignmentAtomically("event-1", _Command())).resolves.toEqual({ status: "conflict", reason: "stale_claim" });
		expect(transaction.workloadAssignment.create).not.toHaveBeenCalled();
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.outboxEvent.updateMany).not.toHaveBeenCalled();
	});

	it("persists PendingPod, advances Assigned, and publishes the exact claim atomically", async function _CommitAssignment()
	{
		const run = { ..._Run(), state: AgentRunState.Queued };
		const event = _Event({ claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1 });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:10.000Z") }]),
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 2 } }), create: vi.fn().mockResolvedValue(_ReleaseEvent()) },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot()) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(_Assignment()) },
			workloadBootstrap: { findUnique: vi.fn(), create: vi.fn().mockResolvedValue(_Bootstrap()) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.commitSuspendedJobAssignmentAtomically("event-1", _Command())).resolves.toEqual({ status: "committed", result: { outcome: "assigned", runId: "run-1", attempt: 1, workloadUid: "job-uid-1" } });
		expect(transaction.workloadAssignment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workloadKind: WorkloadKind.Job, workloadUid: "job-uid-1", workloadProfile: "personal-small", state: WorkloadAssignmentState.PendingPod, expiresAt: new Date("2026-07-20T01:00:10.000Z"), createdAt: new Date("2026-07-20T00:00:10.000Z") }) });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ state: AgentRunState.Queued }), data: { state: AgentRunState.Assigned } });
		expect(transaction.workloadBootstrap.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: _Command().bootstrapReference, claimDigest: "sha256:b5a2a30dadd6b5f535e1a46bb5953096ad9c2a9a4e87f04e69cfbf8aacff361e" }) });
		expect(transaction.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sequence: 3, kind: RunOutboxEventKind.RunWorkloadReleaseRequested, idempotencyKey: "run-1:attempt:1:workload-release", payload: _ReleaseEvent().payload }) });
		expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1 }), data: { publishedAt: new Date("2026-07-20T00:00:10.000Z") } });
		expect(transaction.workloadAssignment.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.agentRun.updateMany.mock.invocationCallOrder[0]!);
		expect(transaction.agentRun.updateMany.mock.invocationCallOrder[0]).toBeLessThan(transaction.workloadBootstrap.create.mock.invocationCallOrder[0]!);
		expect(transaction.workloadBootstrap.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.outboxEvent.create.mock.invocationCallOrder[0]!);
		expect(transaction.outboxEvent.create.mock.invocationCallOrder[0]).toBeLessThan(transaction.outboxEvent.updateMany.mock.invocationCallOrder[0]!);
	});

	it("rejects a controller-selected bootstrap reference that was not derived by the server", async function _RejectSelectedBootstrapReference()
	{
		const run = { ..._Run(), state: AgentRunState.Queued };
		const event = _Event({ claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1 });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:10.000Z") }]),
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn() },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn() },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot()) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.commitSuspendedJobAssignmentAtomically("event-1", { ..._Command(), bootstrapReference: `bootstrap-v1_${"b".repeat(64)}` })).resolves.toEqual({ status: "conflict", reason: "authority_conflict" });
		expect(transaction.workloadAssignment.create).not.toHaveBeenCalled();
	});

	it("never lets assignment or bootstrap lifetime outlive signed membership", async function _ClampAssignmentLifetime()
	{
		const run = { ..._Run(), state: AgentRunState.Queued };
		const event = _Event({ claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1 });
		const createAssignment = vi.fn(async function _Create(input: { data: Record<string, unknown> })
		{
			return { ...input.data, podUid: null, registeredAt: null, revokedAt: null };
		});
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:10.000Z") }]),
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 2 } }), create: vi.fn() },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot("2026-07-20T00:30:00.000Z")) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null), create: createAssignment },
			workloadBootstrap: { create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.commitSuspendedJobAssignmentAtomically("event-1", _Command())).resolves.toMatchObject({ status: "committed" });
		expect(createAssignment).toHaveBeenCalledWith({ data: expect.objectContaining({ expiresAt: new Date("2026-07-20T00:30:00.000Z") }) });
		expect(transaction.workloadBootstrap.create).toHaveBeenCalledWith({ data: expect.objectContaining({ expiresAt: new Date("2026-07-20T00:30:00.000Z") }) });
		expect(transaction.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({ assignmentExpiresAt: "2026-07-20T00:30:00.000Z" }) }) });
	});

	it("rejects an expired signed fleet-membership snapshot at commit", async function _RejectExpiredMembership()
	{
		const run = { ..._Run(), state: AgentRunState.Queued };
		const event = _Event({ claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1 });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T00:00:10.000Z") }]),
			agentService: { findUnique: vi.fn().mockResolvedValue(_Service()) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn() },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn() },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot("2026-07-20T00:00:10.000Z")) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.commitSuspendedJobAssignmentAtomically("event-1", _Command())).resolves.toEqual({ status: "conflict", reason: "authority_conflict" });
		expect(transaction.workloadAssignment.create).not.toHaveBeenCalled();
	});

	it("reclaims a live release under canonical locks and skips expired rows in SQL", async function _ClaimRelease()
	{
		const run = { ..._Run(), state: AgentRunState.Assigned };
		const assignment = _Assignment();
		const bootstrap = _Bootstrap();
		const event = _ReleaseEvent({ claimedAt: new Date("2026-07-20T00:19:00.000Z"), deliveryCount: 3 });
		const queryRaw = vi.fn()
			.mockResolvedValueOnce([{ eventId: "release-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", bootstrapReference: _Command().bootstrapReference }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ now: new Date("2026-07-20T00:20:00.000Z") }]);
		const transaction = {
			$queryRaw: queryRaw,
			agentRun: { findUnique: vi.fn().mockResolvedValue(run) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(assignment) },
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(bootstrap) },
		};
		let traceFields: Record<string, unknown> | undefined;
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { traceFields = ___GetContext()?.extra; return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.claimNextWorkloadReleaseAtomically()).resolves.toEqual({
			status: "claimed",
			claim: {
				lease: { eventId: "release-1", claimedAt: "2026-07-20T00:20:00.000Z", deliveryCount: 4, expiresAt: "2026-07-20T00:20:30.000Z" },
				workload: { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", namespace: "silo-a", serviceAccountName: "agent-runtime-small", workloadUid: "job-uid-1", workloadProfile: "personal-small", assignmentExpiresAt: "2026-07-20T01:00:10.000Z", bootstrapReference: _Command().bootstrapReference },
			},
		});
		const selectionSql = _SqlText(queryRaw.mock.calls[0]?.[0]);
		expect(selectionSql).not.toContain('assignment."expires_at" > clock_timestamp()');
		expect(selectionSql).not.toContain('bootstrap."expires_at" > clock_timestamp()');
		expect(_SqlText(queryRaw.mock.calls[1]?.[0])).toContain("agent_services");
		expect(_SqlText(queryRaw.mock.calls[2]?.[0])).toContain("pg_advisory_xact_lock");
		expect(_SqlText(queryRaw.mock.calls[3]?.[0])).toContain("agent_runs");
		expect(_SqlText(queryRaw.mock.calls[4]?.[0])).toContain("workload_assignments");
		expect(_SqlText(queryRaw.mock.calls[5]?.[0])).toContain("workload_bootstraps");
		expect(_SqlText(queryRaw.mock.calls[6]?.[0])).toContain("run_outbox_events");
		expect(traceFields).toMatchObject({ operation: "run_dispatch.workload_release.claim", namespace: "silo-a" });
		expect(JSON.stringify(traceFields)).not.toContain("bootstrap");
	});

	it("terminalizes an expired head release before claiming the later valid row", async function _RepairExpiredReleaseThenProgress()
	{
		const now = new Date("2026-07-20T00:20:00.000Z");
		const expiredAssignment = _Assignment({ expiresAt: new Date("2026-07-20T00:10:00.000Z") });
		const expiredBootstrap = _Bootstrap({ expiresAt: new Date("2026-07-20T00:10:00.000Z") });
		const expiredEvent = _ReleaseEvent({ id: "release-expired" });
		const expiredQueryRaw = vi.fn()
			.mockResolvedValueOnce([{ eventId: "release-expired", runId: "run-1", attempt: 1, agentServiceId: "service-1", bootstrapReference: _Command().bootstrapReference }])
			.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ now }]);
		const expiredTransaction = {
			$queryRaw: expiredQueryRaw,
			agentRun: { findUnique: vi.fn().mockResolvedValue({ ..._Run(), state: AgentRunState.Assigned }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(expiredEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 3 } }), create: vi.fn().mockResolvedValue({}) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(expiredAssignment), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(expiredBootstrap) },
			conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), create: vi.fn().mockResolvedValue({}) },
		};

		const laterReference = `bootstrap-v1_${"c".repeat(64)}`;
		const laterAssignment = _Assignment({ runId: "run-2", expiresAt: new Date("2026-07-20T01:20:00.000Z") });
		const laterBootstrap = _Bootstrap({ id: laterReference, runId: "run-2", expiresAt: laterAssignment.expiresAt, claimDigest: _BootstrapDigest(laterReference, laterAssignment) });
		const laterEvent = _ReleaseEvent({ id: "release-valid", runId: "run-2", idempotencyKey: "run-2:attempt:1:workload-release", payload: { ..._ReleaseEvent().payload, runId: "run-2", assignmentExpiresAt: laterAssignment.expiresAt.toISOString(), bootstrapReference: laterReference } });
		const laterQueryRaw = vi.fn()
			.mockResolvedValueOnce([{ eventId: "release-valid", runId: "run-2", attempt: 1, agentServiceId: "service-1", bootstrapReference: laterReference }])
			.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ now }]);
		const laterTransaction = {
			$queryRaw: laterQueryRaw,
			agentRun: { findUnique: vi.fn().mockResolvedValue({ ..._Run(), id: "run-2", state: AgentRunState.Assigned }), updateMany: vi.fn() },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(laterEvent), updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn(), create: vi.fn() },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(laterAssignment), updateMany: vi.fn() },
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(laterBootstrap) },
			conversationRunEvent: { aggregate: vi.fn(), create: vi.fn() },
		};
		let transactionCall = 0;
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof expiredTransaction) => Promise<unknown>) { transactionCall += 1; return callback(transactionCall === 1 ? expiredTransaction : laterTransaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.claimNextWorkloadReleaseAtomically()).resolves.toEqual({ status: "terminalized", eventId: "release-expired", runId: "run-1", attempt: 1, failureCode: "RUN_WORKLOAD_RELEASE_AUTHORITY_EXPIRED" });
		expect(expiredTransaction.workloadAssignment.updateMany).toHaveBeenCalledOnce();
		expect(expiredTransaction.agentRun.updateMany).toHaveBeenCalledOnce();
		expect(expiredTransaction.outboxEvent.updateMany).toHaveBeenCalledWith({ where: { id: "release-expired", claimedAt: null, deliveryCount: 0, publishedAt: null, failedAt: null }, data: { claimedAt: now, deliveryCount: 1, failedAt: now, failureCode: "RUN_WORKLOAD_RELEASE_AUTHORITY_EXPIRED" } });
		expect(expiredTransaction.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: RunOutboxEventKind.RunWorkloadCleanupRequested, payload: expect.objectContaining({ mode: "assigned", reason: "dispatch_failure", workloadUid: "job-uid-1" }) }) });

		await expect(repository.claimNextWorkloadReleaseAtomically()).resolves.toMatchObject({ status: "claimed", claim: { lease: { eventId: "release-valid" }, workload: { runId: "run-2" } } });
		expect(laterTransaction.outboxEvent.updateMany).toHaveBeenCalledOnce();
	});

	it("terminalises a release whose canonical bootstrap digest is poisoned so later rows can progress", async function _RejectBootstrapDigestDrift()
	{
		const run = { ..._Run(), state: AgentRunState.Assigned };
		const event = _ReleaseEvent();
		const queryRaw = vi.fn()
			.mockResolvedValueOnce([{ eventId: "release-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", bootstrapReference: _Command().bootstrapReference }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ now: new Date("2026-07-20T00:20:00.000Z") }]);
		const transaction = {
			$queryRaw: queryRaw,
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }), aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 3 } }), create: vi.fn().mockResolvedValue({}) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(_Assignment()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(_Bootstrap({ claimDigest: `sha256:${"0".repeat(64)}` })) },
			conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), create: vi.fn().mockResolvedValue({}) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.claimNextWorkloadReleaseAtomically()).resolves.toEqual({ status: "terminalized", eventId: "release-1", runId: "run-1", attempt: 1, failureCode: "RUN_WORKLOAD_RELEASE_INTEGRITY_INVALID" });
		expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({
			where: { id: "release-1", claimedAt: null, deliveryCount: 0, publishedAt: null, failedAt: null },
			data: {
				claimedAt: new Date("2026-07-20T00:20:00.000Z"),
				deliveryCount: 1,
				failedAt: new Date("2026-07-20T00:20:00.000Z"),
				failureCode: "RUN_WORKLOAD_RELEASE_INTEGRITY_INVALID",
			},
		});
		expect(transaction.workloadAssignment.updateMany).toHaveBeenCalledWith({ where: { runId: "run-1", attempt: 1, state: WorkloadAssignmentState.PendingPod, podUid: null }, data: { state: WorkloadAssignmentState.Revoked, revokedAt: new Date("2026-07-20T00:20:00.000Z") } });
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 1, state: AgentRunState.Assigned }, data: { state: AgentRunState.Failed, terminalReason: AgentRunTerminalReason.RuntimeFailure, finishedAt: new Date("2026-07-20T00:20:00.000Z") } });
		expect(transaction.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: RunOutboxEventKind.RunWorkloadCleanupRequested, payload: expect.objectContaining({ mode: "assigned", reason: "dispatch_failure", workloadUid: "job-uid-1" }) }) });
		expect(transaction.conversationRunEvent.create).toHaveBeenCalledWith({ data: { runId: "run-1", sequence: 5, type: "run.failed", payload: { terminalReason: "runtime_failure", failureCode: "RUN_WORKLOAD_RELEASE_INTEGRITY_INVALID" }, occurredAt: new Date("2026-07-20T00:20:00.000Z") } });
	});

	it("replays the durable assignment after revocation, membership expiry, and a next attempt", async function _AssignmentReplayAfterLifecycleAdvance()
	{
		const run = { ..._Run(), attempt: 2, state: AgentRunState.Accepted };
		const event = _Event({ claimedAt: new Date("2026-07-20T00:00:00.000Z"), deliveryCount: 1, publishedAt: new Date("2026-07-20T00:00:10.000Z") });
		const assignment = _Assignment({ state: WorkloadAssignmentState.Revoked, podUid: "pod-uid-1", registeredAt: new Date("2026-07-20T00:20:10.000Z"), revokedAt: new Date("2026-07-20T00:30:00.000Z") });
		const release = _ReleaseEvent();
		const findEvent = vi.fn(async function _FindEvent(input: { where: Record<string, unknown> })
		{
			return "idempotencyKey" in input.where ? release : event;
		});
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ now: new Date("2026-07-20T03:00:00.000Z") }]),
			agentService: { findUnique: vi.fn().mockResolvedValue({ ..._Service(), state: AgentServiceState.Paused }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn() },
			outboxEvent: { findUnique: findEvent, updateMany: vi.fn() },
			runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(_Snapshot("2026-07-20T01:00:00.000Z")) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(assignment), create: vi.fn() },
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(_Bootstrap()), create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.commitSuspendedJobAssignmentAtomically("event-1", _Command())).resolves.toEqual({ status: "committed", result: { outcome: "idempotent", runId: "run-1", attempt: 1, workloadUid: "job-uid-1" } });
		expect(transaction.workloadAssignment.create).not.toHaveBeenCalled();
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.outboxEvent.updateMany).not.toHaveBeenCalled();
	});

	it("registers the first Pod and publishes the exact release in one transaction", async function _RegisterFirstPod()
	{
		const run = { ..._Run(), state: AgentRunState.Assigned };
		const event = _ReleaseEvent({ claimedAt: new Date("2026-07-20T00:20:00.000Z"), deliveryCount: 1 });
		const assignment = _Assignment();
		const queryRaw = _RegistrationQueryRaw(new Date("2026-07-20T00:20:10.000Z"));
		const transaction = {
			$queryRaw: queryRaw,
			agentRun: { findUnique: vi.fn().mockResolvedValue(run) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(assignment), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(_Bootstrap()) },
		};
		let traceFields: Record<string, unknown> | undefined;
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { traceFields = ___GetContext()?.extra; return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.registerFirstPodAndPublishReleaseAtomically("release-1", _Registration())).resolves.toEqual({ status: "registered", result: { outcome: "registered", runId: "run-1", attempt: 1, workloadUid: "job-uid-1", podUid: "pod-uid-1" } });
		expect(transaction.workloadAssignment.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ workloadProfile: "personal-small", state: WorkloadAssignmentState.PendingPod, podUid: null }), data: { state: WorkloadAssignmentState.Registered, podUid: "pod-uid-1", registeredAt: new Date("2026-07-20T00:20:10.000Z") } });
		expect(transaction.outboxEvent.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "release-1", deliveryCount: 1 }), data: { publishedAt: new Date("2026-07-20T00:20:10.000Z") } });
		expect(traceFields).toMatchObject({ operation: "run_dispatch.workload_release.register", eventId: "release-1", runId: "run-1", attempt: 1, workloadUid: "job-uid-1", podUid: "pod-uid-1" });
		expect(JSON.stringify(traceFields)).not.toContain("bootstrap");
	});

	it("returns exact registration replay after revocation and a next attempt, but rejects another Pod", async function _RegistrationReplay()
	{
		const run = { ..._Run(), attempt: 2, state: AgentRunState.Accepted };
		const event = _ReleaseEvent({ claimedAt: new Date("2026-07-20T00:20:00.000Z"), deliveryCount: 1, publishedAt: new Date("2026-07-20T00:20:10.000Z") });
		const assignment = _Assignment({ state: WorkloadAssignmentState.Revoked, podUid: "pod-uid-1", registeredAt: new Date("2026-07-20T00:20:10.000Z"), revokedAt: new Date("2026-07-20T01:00:00.000Z") });
		const queryRaw = _RegistrationQueryRaw(new Date("2026-07-20T02:00:00.000Z"));
		const transaction = {
			$queryRaw: queryRaw,
			agentRun: { findUnique: vi.fn().mockResolvedValue(run) },
			outboxEvent: { findUnique: vi.fn().mockResolvedValue(event), updateMany: vi.fn() },
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(assignment), updateMany: vi.fn() },
			workloadBootstrap: { findUnique: vi.fn().mockResolvedValue(_Bootstrap()) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunDispatchRepository(prisma, { namespace: "silo-a", claimLeaseMilliseconds: 30_000, assignmentTtlMilliseconds: 3_600_000 }, _Issuer());

		await expect(repository.registerFirstPodAndPublishReleaseAtomically("release-1", _Registration())).resolves.toEqual({ status: "registered", result: { outcome: "idempotent", runId: "run-1", attempt: 1, workloadUid: "job-uid-1", podUid: "pod-uid-1" } });
		await expect(repository.registerFirstPodAndPublishReleaseAtomically("release-1", { ..._Registration(), podUid: "pod-uid-2" })).resolves.toEqual({ status: "conflict", reason: "pod_conflict" });
		expect(transaction.workloadAssignment.updateMany).not.toHaveBeenCalled();
		expect(transaction.outboxEvent.updateMany).not.toHaveBeenCalled();
	});
});
