import type { PrismaClient } from "@prisma/client";
import { __CreateCapabilitySet, __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PrismaChildRunReservationRepository } from "../prisma-child-run-reservation-repository.js";

/** Creates a complete immutable snapshot for either the locked parent or the derived child. */
function _snapshot(runId: string, agentServiceId: string, agentRevisionId: string, digest: string): RunInputSnapshot
{
	return {
		runId, siloId: "silo-1", agentServiceId, agentRevisionId, snapshotVersion: 2, threadId: "thread-1", messageIds: ["message-1"], personaRevisionId: "persona-1", preferenceFactIds: ["preference-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"], memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: `sha256:${"e".repeat(64)}`, provenance: [{ sourceKind: "message", sourceId: "message-1", capturedAt: "2026-07-20T00:00:00.000Z" }] }], memoryQueryPolicy: { scope: "personal" }, integrationAssignments: [{ integrationId: "integration-1", allowedTools: ["tool-1"] }], modelRoute: { alias: "target" }, budgetPolicy: { maxModelTurns: 4, maxTotalTokens: 1000, maxCostUsdMicros: 500000, wallClockDeadlineEpochMs: Date.parse("2026-07-20T00:02:00.000Z") }, identitySnapshot: { executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 4, fleetMembershipIssuer: "opencrane-fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"d".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-20T01:00:00.000Z" }, capabilitySetDigest: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", capabilitySet: [], effectiveContractDigest: `sha256:${"b".repeat(64)}`, promptCompilerVersion: "prompt-v1", digest, compiledAt: "2026-07-20T00:00:00.000Z",
	};
}

/** Creates a child snapshot whose runtime-visible ceiling exactly matches the reservation allocation. */
function _childSnapshot(): RunInputSnapshot
{
	return { ..._snapshot("child-run-1", "child-service-1", "child-revision-1", `sha256:${"f".repeat(64)}`), budgetPolicy: { maxModelTurns: 2, maxTotalTokens: 300, maxCostUsdMicros: 200000, wallClockDeadlineEpochMs: Date.parse("2026-07-20T00:01:00.000Z") } };
}

/** Creates one detached child-run authority that exactly matches the test parent. */
function _command()
{
	return {
		childRunId: "child-run-1", requestIdempotencyKey: "child-request-1", parentRunId: "parent-run-1", parentSnapshotDigest: `sha256:${"c".repeat(64)}`, parentAttempt: 1, maximumChildrenPerParent: 2,
		request: { siloId: "silo-1", agentServiceId: "child-service-1", capabilitySetDigest: __CreateCapabilitySet([])!.digest, context: { messageIds: ["message-1"], memoryFactIds: ["fact-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"] }, budget: { maxModelTurns: 2, maxTotalTokens: 300, maxCostUsdMicros: 200000, maxDurationMs: 60000 }, task: { goal: "research" } },
	} as const;
}

/** Creates the exact authorization a lock-held callback derives from the test runtime request. */
function _authorization()
{
	const capabilitySet = __CreateCapabilitySet([])!;
	return { siloId: "silo-1", rootRunId: "root-run-1", parentRunId: "parent-run-1", depth: 1, capabilitySetDigest: capabilitySet.digest, capabilitySet, agentServiceId: "child-service-1", context: { messageIds: ["message-1"], memoryFactIds: ["fact-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"] }, budget: { maxModelTurns: 2, maxTotalTokens: 300, maxCostUsdMicros: 200000, maxDurationMs: 60000 }, task: { goal: "research" } } as const;
}

/** Creates one parent AgentRun row returned after the repository obtains its row lock. */
function _parentRun()
{
	return { id: "parent-run-1", siloId: "silo-1", agentServiceId: "parent-service-1", parentRunId: null, rootRunId: "root-run-1", state: "Running", attempt: 1, inputSnapshotDigest: `sha256:${"c".repeat(64)}` };
}

/** Creates a persistence mock whose transaction callback receives the supplied authority operations. */
function _prisma(transaction: object): PrismaClient
{
	return { $transaction: vi.fn(async function _transaction(callback: (client: object) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
}

/** Creates a reservation repository with a stable server clock for immutable deadline assertions. */
function _repository(transaction: object): PrismaChildRunReservationRepository
{
	return new PrismaChildRunReservationRepository(_prisma(transaction), undefined, function _now(): number { return Date.parse("2026-07-20T00:00:00.000Z"); });
}

describe("PrismaChildRunReservationRepository", function _describeChildRunReservationRepository()
{
	it("locks the parent, builds under that lock, and atomically writes child, snapshot, reservation and initial outbox", async function _persistsChildReservation()
	{
		const parentSnapshot = _snapshot("parent-run-1", "parent-service-1", "parent-revision-1", `sha256:${"c".repeat(64)}`);
		const childSnapshot = _childSnapshot();
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValueOnce(_parentRun()).mockResolvedValueOnce(null), create: vi.fn().mockResolvedValue({ id: "child-run-1" }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...parentSnapshot, compiledAt: new Date(parentSnapshot.compiledAt) }), create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) }, childRunReservation: { findUnique: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _count: { childRunId: 0 }, _sum: { maxModelTurns: null, maxTotalTokens: null, maxCostUsdMicros: null, maxDurationMs: null } }), create: vi.fn().mockResolvedValue({ childRunId: "child-run-1" }) }, outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) } };
		const repository = _repository(transaction);
		const build = vi.fn(async function _build(parent) { expect(parent.snapshot).toEqual(parentSnapshot); expect(parent.agentServiceId).toBe("parent-service-1"); expect(parent.remainingBudget).toEqual({ maxModelTurns: 4, maxTotalTokens: 1000, maxCostUsdMicros: 500000, maxDurationMs: 120000 }); return { authorization: _authorization(), snapshot: childSnapshot, agentRevisionId: "child-revision-1", effectiveContractDigest: childSnapshot.effectiveContractDigest }; });

		await expect(repository.reserve(_command(), build)).resolves.toEqual({ outcome: "reserved", snapshot: childSnapshot });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "child-run-1", trigger: "ManagedInvocation", parentRunId: "parent-run-1", rootRunId: "root-run-1", requestIdempotencyKey: "child-request-1" }) });
		expect(transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "child-run-1", digest: childSnapshot.digest }) });
		expect(transaction.childRunReservation.create).toHaveBeenCalledWith({ data: { childRunId: "child-run-1", parentRunId: "parent-run-1", rootRunId: "root-run-1", depth: 1, maxModelTurns: 2, maxTotalTokens: 300, maxCostUsdMicros: 200000n, maxDurationMs: 60000, task: { goal: "research" }, taskDigest: __DigestCanonicalJson({ goal: "research" }) } });
		expect(transaction.outboxEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ sequence: 1, kind: "RunAccepted", idempotencyKey: "child-run-1:accepted" }), expect.objectContaining({ sequence: 2, kind: "RunAttemptRequested", idempotencyKey: "child-run-1:attempt:1" })] });
	});

	it("returns the first child only when its immutable reservation and snapshot scope match the duplicate request", async function _returnsIdempotentChild()
	{
		const parentSnapshot = _snapshot("parent-run-1", "parent-service-1", "parent-revision-1", `sha256:${"c".repeat(64)}`);
		const childSnapshot = _childSnapshot();
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValueOnce(_parentRun()).mockResolvedValueOnce({ id: "child-run-1", siloId: "silo-1", agentServiceId: "child-service-1", parentRunId: "parent-run-1", rootRunId: "root-run-1", trigger: "ManagedInvocation", inputSnapshotDigest: childSnapshot.digest }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValueOnce({ ...parentSnapshot, compiledAt: new Date(parentSnapshot.compiledAt) }).mockResolvedValueOnce({ ...childSnapshot, compiledAt: new Date(childSnapshot.compiledAt) }), create: vi.fn() }, childRunReservation: { findUnique: vi.fn().mockResolvedValue({ childRunId: "child-run-1", parentRunId: "parent-run-1", rootRunId: "root-run-1", depth: 1, maxModelTurns: 2, maxTotalTokens: 300, maxCostUsdMicros: 200000n, maxDurationMs: 60000, task: { goal: "research" }, taskDigest: __DigestCanonicalJson({ goal: "research" }) }), aggregate: vi.fn(), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const repository = _repository(transaction);
		const build = vi.fn();

		await expect(repository.reserve(_command(), build)).resolves.toEqual({ outcome: "idempotent", snapshot: childSnapshot });
		expect(build).not.toHaveBeenCalled();
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
		expect(transaction.childRunReservation.create).not.toHaveBeenCalled();
	});

	it("rejects a stale parent digest before callback compilation or child writes", async function _rejectsStaleParent()
	{
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ ..._parentRun(), inputSnapshotDigest: `sha256:${"9".repeat(64)}` }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn(), create: vi.fn() }, childRunReservation: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const repository = _repository(transaction);
		const build = vi.fn();

		await expect(repository.reserve(_command(), build)).resolves.toEqual({ outcome: "denied", reason: "parent_snapshot_stale" });
		expect(build).not.toHaveBeenCalled();
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("denies sibling fan-out or durable allocation overdraw before compiling a new child", async function _deniesExhaustedParentCapacity()
	{
		const parentSnapshot = _snapshot("parent-run-1", "parent-service-1", "parent-revision-1", `sha256:${"c".repeat(64)}`);
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValueOnce(_parentRun()).mockResolvedValueOnce(null), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...parentSnapshot, compiledAt: new Date(parentSnapshot.compiledAt) }), create: vi.fn() }, childRunReservation: { findUnique: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _count: { childRunId: 2 }, _sum: { maxModelTurns: 1, maxTotalTokens: 200, maxCostUsdMicros: 400000n, maxDurationMs: 30000 } }), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const repository = _repository(transaction);
		const build = vi.fn();

		await expect(repository.reserve(_command(), build)).resolves.toEqual({ outcome: "denied", reason: "authority_conflict" });
		expect(transaction.childRunReservation.aggregate).toHaveBeenCalledWith({ where: { parentRunId: "parent-run-1" }, _count: { childRunId: true }, _sum: { maxModelTurns: true, maxTotalTokens: true, maxCostUsdMicros: true, maxDurationMs: true } });
		expect(build).not.toHaveBeenCalled();
	});

	it("rejects a derived snapshot that changes the locked parent thread before persistence", async function _rejectsThreadEscalation()
	{
		const parentSnapshot = _snapshot("parent-run-1", "parent-service-1", "parent-revision-1", `sha256:${"c".repeat(64)}`);
		const childSnapshot = { ..._childSnapshot(), threadId: "thread-2" };
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValueOnce(_parentRun()).mockResolvedValueOnce(null), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...parentSnapshot, compiledAt: new Date(parentSnapshot.compiledAt) }), create: vi.fn() }, childRunReservation: { findUnique: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _count: { childRunId: 0 }, _sum: { maxModelTurns: null, maxTotalTokens: null, maxCostUsdMicros: null, maxDurationMs: null } }), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const repository = _repository(transaction);

		await expect(repository.reserve(_command(), async function _build() { return { authorization: _authorization(), snapshot: childSnapshot, agentRevisionId: "child-revision-1", effectiveContractDigest: childSnapshot.effectiveContractDigest }; })).resolves.toEqual({ outcome: "denied", reason: "authority_conflict" });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
		expect(transaction.runInputSnapshot.create).not.toHaveBeenCalled();
	});
});
