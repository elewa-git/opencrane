import { Prisma, type PrismaClient } from "@prisma/client";
import type { RunInputSnapshot } from "@opencrane/contracts";
import type { Logger } from "@opencrane/observability";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunAdmissionRepository } from "../prisma-run-admission-repository.js";

/** Creates one complete canonical snapshot accepted at initial logical-run admission. */
function _snapshot(): RunInputSnapshot
{
	return {
		runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, threadId: "thread-1", messageIds: ["message-1"], personaRevisionId: "persona-1", preferenceFactIds: ["preference-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"], memoryFacts: [{ datasetId: "dataset-1", factId: "fact-1", contentDigest: `sha256:${"e".repeat(64)}`, provenance: [{ sourceKind: "message", sourceId: "message-1", capturedAt: "2026-07-20T00:00:00.000Z" }] }], memoryQueryPolicy: { scope: "personal" }, toolGrantIds: ["grant-1"], modelRoute: { alias: "target" }, budgetPolicy: { maxTokens: 1000 }, identitySnapshot: { executionSubjectId: "user-1", fleetMembershipRevision: 4, fleetMembershipIssuer: "opencrane-fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"d".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-20T01:00:00.000Z" }, capabilitySetDigest: `sha256:${"a".repeat(64)}`, effectiveContractDigest: `sha256:${"b".repeat(64)}`, promptCompilerVersion: "prompt-v1", digest: `sha256:${"c".repeat(64)}`, compiledAt: "2026-07-20T00:00:00.000Z",
	};
}

/** Creates a target initial-admission command matching the canonical test snapshot. */
function _command()
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-1", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" } as const;
}

/** Creates the immutable authority facts that are revalidated within the admission transaction. */
function _authority()
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: "personal", effectiveContractDigest: `sha256:${"b".repeat(64)}`, promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null } as const;
}

describe("PrismaRunAdmissionRepository", function _describeAdmissionRepository()
{
	it("creates the logical run, immutable snapshot, and ordered acceptance/dispatch events in one transaction", async function _persistsAdmission()
	{
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run-1" }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) }, outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma, { now: function _now() { return new Date("2026-07-20T00:00:00.000Z"); } });

		await expect(repository.admit(_command(), async function _build() { return { outcome: "ready", value: { authority: _authority(), snapshot: _snapshot() } } as const; })).resolves.toEqual({ outcome: "accepted", snapshot: _snapshot() });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ inputSnapshotDigest: `sha256:${"c".repeat(64)}`, acceptedAt: new Date("2026-07-20T00:00:00.000Z") }) });
		expect(transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", digest: `sha256:${"c".repeat(64)}`, messageIds: ["message-1"] }) });
		expect(transaction.outboxEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ sequence: 1, kind: "RunAccepted", idempotencyKey: "run-1:accepted" }), expect.objectContaining({ sequence: 2, kind: "RunAttemptRequested", idempotencyKey: "run-1:attempt:1" })] });
	});

	it("returns a null-thread snapshot before a later retry can load or compile a new request instant", async function _returnsIdempotent()
	{
		const snapshot = { ..._snapshot(), threadId: null };
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, threadId: snapshot.threadId, trigger: "Interactive", delegatedUserId: snapshot.identitySnapshot.executionSubjectId, inputSnapshotDigest: snapshot.digest }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, compiledAt: new Date(snapshot.compiledAt) }), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma, { now: function _now() { return new Date("2026-07-20T00:05:00.000Z"); } });
		let compiled = false;

		await expect(repository.admit({ ..._command(), threadId: null }, async function _build() { compiled = true; return { outcome: "ready", value: { authority: _authority(), snapshot } } as const; })).resolves.toEqual({ outcome: "idempotent", snapshot });
		expect(compiled).toBe(false);
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
		expect(transaction.runInputSnapshot.create).not.toHaveBeenCalled();
	});

	it.each([
		["another agent service", { agentServiceId: "service-2" }],
		["another conversation thread", { threadId: "thread-2" }],
		["another execution subject", { delegatedUserId: "user-2" }],
	])("denies a same-silo delivery key already used by %s", async function _deniesCrossScopeDuplicate(_description: string, difference: object)
	{
		const snapshot = _snapshot();
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, threadId: snapshot.threadId, trigger: "Interactive", delegatedUserId: snapshot.identitySnapshot.executionSubjectId, inputSnapshotDigest: snapshot.digest, ...difference }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn(), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);
		const build = vi.fn();

		await expect(repository.admit(_command(), build)).resolves.toEqual({ outcome: "denied", reason: "authority_conflict" });
		expect(build).not.toHaveBeenCalled();
		expect(transaction.runInputSnapshot.findUnique).not.toHaveBeenCalled();
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("fails closed after a unique-conflict recovery finds a same-silo key from another subject", async function _deniesCrossScopeConflictRecovery()
	{
		const duplicateError = new Prisma.PrismaClientKnownRequestError("duplicate run admission", { code: "P2002", clientVersion: "6.19.3" });
		const snapshot = _snapshot();
		const prisma = { $transaction: vi.fn().mockRejectedValue(duplicateError), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, threadId: snapshot.threadId, trigger: "Interactive", delegatedUserId: "user-2", inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn() } } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _unexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "denied", reason: "authority_conflict" });
		expect(prisma.runInputSnapshot.findUnique).not.toHaveBeenCalled();
	});

	it("rejects an interactive authority whose delegated user differs from the signed snapshot subject", async function _rejectsDelegationMismatch()
	{
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn(), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _build() { return { outcome: "ready", value: { authority: { ..._authority(), delegatedUserId: "user-2" }, snapshot: _snapshot() } } as const; })).resolves.toEqual({ outcome: "denied", reason: "authority_conflict" });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("returns the first snapshot after a same-scope unique-conflict recovery", async function _returnsSameScopeConflictRecovery()
	{
		const duplicateError = new Prisma.PrismaClientKnownRequestError("duplicate run admission", { code: "P2002", clientVersion: "6.19.3" });
		const snapshot = _snapshot();
		const prisma = { $transaction: vi.fn().mockRejectedValue(duplicateError), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, threadId: snapshot.threadId, trigger: "Interactive", delegatedUserId: snapshot.identitySnapshot.executionSubjectId, inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, compiledAt: new Date(snapshot.compiledAt) }) } } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _unexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "idempotent", snapshot });
	});

	it("denies a recovered snapshot that names another execution subject", async function _deniesSnapshotSubjectMismatch()
	{
		const snapshot = { ..._snapshot(), identitySnapshot: { ..._snapshot().identitySnapshot, executionSubjectId: "user-2" } };
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, threadId: snapshot.threadId, trigger: "Interactive", delegatedUserId: "user-1", inputSnapshotDigest: snapshot.digest }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, compiledAt: new Date(snapshot.compiledAt) }), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _unexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "denied", reason: "authority_conflict" });
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
	});

	it("fails closed and logs safe authority coordinates when persistence is unavailable", async function _LogsPersistenceFailure()
	{
		const persistenceError = new Error("database unavailable");
		const prisma = { $transaction: vi.fn().mockRejectedValue(persistenceError) } as unknown as PrismaClient;
		const error = vi.fn();
		const log = { error } as unknown as Logger;
		const repository = new PrismaRunAdmissionRepository(prisma, { now: function _now() { return new Date("2026-07-20T00:00:00.000Z"); } }, log);

		await expect(repository.admit(_command(), async function _UnexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(error).toHaveBeenCalledWith({ err: persistenceError, runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", failureKind: "transaction_failed" }, "personal run admission persistence failed");
		expect(error.mock.calls[0]?.[0]).not.toHaveProperty("requestIdempotencyKey");
	});

	it("fails closed and identifies a failed duplicate recovery without logging its key", async function _LogsDuplicateRecoveryFailure()
	{
		const duplicateError = new Prisma.PrismaClientKnownRequestError("duplicate run admission", { code: "P2002", clientVersion: "6.19.3" });
		const recoveryError = new Error("recovery lookup unavailable");
		const prisma = { $transaction: vi.fn().mockRejectedValue(duplicateError), agentRun: { findUnique: vi.fn().mockRejectedValue(recoveryError) }, runInputSnapshot: { findUnique: vi.fn() } } as unknown as PrismaClient;
		const error = vi.fn();
		const log = { error } as unknown as Logger;
		const repository = new PrismaRunAdmissionRepository(prisma, { now: function _now() { return new Date("2026-07-20T00:00:00.000Z"); } }, log);

		await expect(repository.admit(_command(), async function _UnexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(error).toHaveBeenCalledWith({ err: recoveryError, runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", failureKind: "duplicate_recovery_failed" }, "personal run admission persistence failed");
		expect(error.mock.calls[0]?.[0]).not.toHaveProperty("requestIdempotencyKey");
	});
});
