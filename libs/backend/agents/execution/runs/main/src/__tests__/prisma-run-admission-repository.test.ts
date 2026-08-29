import { Prisma, type PrismaClient } from "@prisma/client";
import { AgentServiceKinds, RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import type { Logger } from "@opencrane/backend/observability";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { PrismaRunAdmissionRepository } from "../prisma-run-admission-repository";
import { RunAdmissionDenialReasons } from "../run-admission.types";

/** Build one reviewed tool definition. */
function _Tool(name = "search")
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { name, description: `${name} description`, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

/** Creates one complete canonical snapshot accepted at initial logical-run admission. */
function _snapshot(): RunInputSnapshot
{
		return {
			runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "conversation-1", messageIds: ["message-1"], personaRevisionId: "persona-1", preferenceFactIds: ["preference-1"], artifactRevisionIds: ["artifact-1"], skillRevisionIds: ["skill-1"], memoryQueryPolicy: { scope: "personal" }, integrationAssignments: [{ integrationId: "integration-1", toolDefinitions: [_Tool()] }], mcpTools: [], modelRoute: { alias: "target" }, budgetPolicy: { maxTokens: 1000 }, identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionIssuer: "https://issuer.test", executionSubjectId: "user-1", principalId: "principal-1", fleetMembershipRevision: 4, fleetMembershipIssuer: "opencrane-fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"d".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-20T01:00:00.000Z" }, capabilitySetDigest: `sha256:${"a".repeat(64)}`, effectiveContractDigest: `sha256:${"b".repeat(64)}`, promptCompilerVersion: "prompt-v1", digest: `sha256:${"c".repeat(64)}`, compiledAt: "2026-07-20T00:00:00.000Z",
		};
}

/** Creates a target initial-admission command matching the canonical test snapshot. */
function _command()
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", identityKind: RunInputSnapshotIdentityKinds.User, trigger: "interactive", executionIssuer: "https://issuer.test", executionSubjectId: "user-1", requestIdempotencyKey: "request-1" } as const;
}

/** Creates the immutable authority facts that are revalidated within the admission transaction. */
function _authority()
{
	return { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Personal, effectiveContractDigest: `sha256:${"b".repeat(64)}`, promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null } as const;
}

describe("PrismaRunAdmissionRepository", function _describeAdmissionRepository()
{
	it("admits a scheduled managed run without accepting a user-shaped execution subject", async function _admitsManagedService()
	{
		const snapshot = { ..._snapshot(), conversationId: null, personaRevisionId: null, memoryQueryPolicy: { scope: "none" }, identitySnapshot: { kind: RunInputSnapshotIdentityKinds.Service, executionSubjectId: "agent-service:service-1", agentServiceId: "service-1", effectiveBoundaryAttachments: [], effectiveBoundaryAttachmentDigest: `sha256:${"f".repeat(64)}`, fleetMembershipRevision: 4, fleetMembershipIssuer: "opencrane-fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"d".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-20T01:00:00.000Z" } } as RunInputSnapshot;
		const command = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: null, identityKind: RunInputSnapshotIdentityKinds.Service, trigger: "schedule", requestIdempotencyKey: "schedule:service-1:slot-1" } as const;
		const authority = { ..._authority(), agentKind: AgentServiceKinds.Managed, trigger: "schedule", delegatedUserId: null } as const;
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run-1" }) }, runInputSnapshot: { create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) }, outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma, { now: function _now() { return new Date("2026-07-20T00:00:00.000Z"); } });

		await expect(repository.admit(command, async function _build() { return { outcome: "ready", value: { authority, snapshot } } as const; })).resolves.toMatchObject({ outcome: "accepted" });
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ trigger: "Schedule", delegatedUserId: null }) });
	});

	it("creates the logical run, immutable snapshot, and ordered acceptance/dispatch events in one transaction", async function _persistsAdmission()
	{
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run-1" }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "snapshot-1" }) }, outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma, { now: function _now() { return new Date("2026-07-20T00:00:00.000Z"); } });

		await expect(repository.admit(_command(), async function _build() { return { outcome: "ready", value: { authority: _authority(), snapshot: _snapshot() } } as const; })).resolves.toEqual({ outcome: "accepted", snapshot: _snapshot() });
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
		expect((transaction.$queryRaw.mock.calls[0]?.[0] as { sql: string }).sql).toContain('::text AS "lock"');
		// PostgreSQL rejects a NUL byte in text with SQLSTATE 22021 and fails the whole statement, so
		// an advisory-lock key carrying one made every admission return 503 against a real database.
		for (const [statement] of transaction.$queryRaw.mock.calls)
		{
			expect((statement as { values: unknown[] }).values.filter(function _IsText(value): value is string { return typeof value === "string"; }).join("")).not.toContain(String.fromCharCode(0));
		}
		expect(transaction.agentRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ inputSnapshotDigest: `sha256:${"c".repeat(64)}`, acceptedAt: new Date("2026-07-20T00:00:00.000Z") }) });
		expect(transaction.runInputSnapshot.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: "run-1", digest: `sha256:${"c".repeat(64)}`, messageIds: ["message-1"] }) });
		expect(transaction.outboxEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ sequence: 1, kind: "RunAccepted", idempotencyKey: "run-1:accepted" }), expect.objectContaining({ sequence: 2, kind: "RunAttemptRequested", idempotencyKey: "run-1:attempt:1" })] });
	});

	it("runs caller-owned persistence after run rows inside the same serializable transaction", async function _RunsCommitParticipant()
	{
		const order: string[] = [];
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async function _CreateRun() { order.push("run"); }) },
			runInputSnapshot: { create: vi.fn(async function _CreateSnapshot() { order.push("snapshot"); }) },
			outboxEvent: { createMany: vi.fn(async function _CreateOutbox() { order.push("outbox"); }) },
		};
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>, options: { readonly isolationLevel: Prisma.TransactionIsolationLevel }) { expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable); return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _Build() { return { outcome: "ready", value: { authority: _authority(), snapshot: _snapshot() } } as const; }, async function _Commit(transactionContext, value)
		{
			expect(transactionContext.prisma).toBe(transaction);
			expect(value.snapshot.runId).toBe("run-1");
			order.push("message");
		})).resolves.toMatchObject({ outcome: "accepted" });
		expect(order).toEqual(["run", "snapshot", "outbox", "message"]);
	});

	it("prepares child authority before compilation and commits remaining writes last", async function _PreparesChildAuthority()
	{
		const order: string[] = [];
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async function _CreateRun() { order.push("run"); }) }, runInputSnapshot: { create: vi.fn(async function _CreateSnapshot() { order.push("snapshot"); }) }, outboxEvent: { createMany: vi.fn(async function _CreateOutbox() { order.push("outbox"); }) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _Build()
		{
			order.push("build");
			return { outcome: "ready", value: { authority: _authority(), snapshot: _snapshot() } } as const;
		}, async function _Commit() { order.push("commit"); }, async function _Prepare() { order.push("prepare"); })).resolves.toMatchObject({ outcome: "accepted" });
		expect(order).toEqual(["prepare", "build", "run", "snapshot", "outbox", "commit"]);
	});

	it("rolls back prepared child authority when snapshot compilation denies", async function _RollsBackPreparedAuthority()
	{
		const committedChildren: string[] = [];
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue(null) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>)
		{
			const pendingChildren: string[] = [];
			try
			{
				const result = await callback({ ...transaction, pendingChildren } as never);
				committedChildren.push(...pendingChildren);
				return result;
			}
			catch (error) { throw error; }
		}) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _Deny() { return { outcome: "denied", reason: "persona_unavailable" } as const; }, undefined, async function _Prepare(context)
		{
			(context.prisma as unknown as { pendingChildren: string[] }).pendingChildren.push("child-1");
		})).resolves.toEqual({ outcome: "denied", reason: "persona_unavailable" });
		expect(committedChildren).toEqual([]);
	});

	it("rolls back prepared child authority when compiled coordinates conflict", async function _RollsBackPreparedAuthorityConflict()
	{
		const committedChildren: string[] = [];
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue(null) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>)
		{
			const pendingChildren: string[] = [];
			const result = await callback({ ...transaction, pendingChildren } as never);
			committedChildren.push(...pendingChildren);
			return result;
		}) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _BuildConflict() { return { outcome: "ready", value: { authority: { ..._authority(), delegatedUserId: "user-2" }, snapshot: _snapshot() } } as const; }, undefined, async function _Prepare(context)
		{
			(context.prisma as unknown as { pendingChildren: string[] }).pendingChildren.push("child-1");
		})).resolves.toEqual({ outcome: "denied", reason: RunAdmissionDenialReasons.AuthorityConflict });
		expect(committedChildren).toEqual([]);
	});

	it("does not replay preparation for an existing exact run", async function _SkipsPrepareForIdempotentRun()
	{
		const snapshot = _snapshot();
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, conversationId: snapshot.conversationId, trigger: "Interactive", delegatedUserId: snapshot.identitySnapshot.executionSubjectId, inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, compiledAt: new Date(snapshot.compiledAt) }) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);
		const prepare = vi.fn();

		await expect(repository.admit(_command(), async function _UnexpectedBuild() { throw new Error("unexpected build"); }, undefined, prepare)).resolves.toEqual({ outcome: "idempotent", snapshot });
		expect(prepare).not.toHaveBeenCalled();
	});

	it("returns a null-conversation snapshot before a later retry can load or compile a new request instant", async function _returnsIdempotent()
	{
		const snapshot = { ..._snapshot(), conversationId: null };
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, conversationId: snapshot.conversationId, trigger: "Interactive", delegatedUserId: snapshot.identitySnapshot.executionSubjectId, inputSnapshotDigest: snapshot.digest }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, compiledAt: new Date(snapshot.compiledAt) }), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma, { now: function _now() { return new Date("2026-07-20T00:05:00.000Z"); } });
		let compiled = false;

		await expect(repository.admit({ ..._command(), conversationId: null }, async function _build() { compiled = true; return { outcome: "ready", value: { authority: _authority(), snapshot } } as const; })).resolves.toEqual({ outcome: "idempotent", snapshot });
		expect(compiled).toBe(false);
		expect(transaction.agentRun.create).not.toHaveBeenCalled();
		expect(transaction.runInputSnapshot.create).not.toHaveBeenCalled();
	});

	it.each([
		["another agent service", { agentServiceId: "service-2" }],
		["another conversation conversation", { conversationId: "conversation-2" }],
		["another execution subject", { delegatedUserId: "user-2" }],
	])("denies a same-silo delivery key already used by %s", async function _deniesCrossScopeDuplicate(_description: string, difference: object)
	{
		const snapshot = _snapshot();
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, conversationId: snapshot.conversationId, trigger: "Interactive", delegatedUserId: snapshot.identitySnapshot.executionSubjectId, inputSnapshotDigest: snapshot.digest, ...difference }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn(), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
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
		const prisma = { $transaction: vi.fn().mockRejectedValue(duplicateError), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, conversationId: snapshot.conversationId, trigger: "Interactive", delegatedUserId: "user-2", inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn() } } as unknown as PrismaClient;
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
		const prisma = { $transaction: vi.fn().mockRejectedValue(duplicateError), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, conversationId: snapshot.conversationId, trigger: "Interactive", delegatedUserId: snapshot.identitySnapshot.executionSubjectId, inputSnapshotDigest: snapshot.digest }) }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, compiledAt: new Date(snapshot.compiledAt) }) } } as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma);

		await expect(repository.admit(_command(), async function _unexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "idempotent", snapshot });
	});

	it("does not misclassify an unknown unique conflict when no same-key or active-conversation row exists", async function _keepsUnknownConflictUnavailable()
	{
		const duplicateError = new Prisma.PrismaClientKnownRequestError("another unique authority failed", { code: "P2002", clientVersion: "6.19.3" });
		const error = vi.fn();
		const log = { error } as unknown as Logger;
		const prisma = {
			$transaction: vi.fn().mockRejectedValue(duplicateError),
			agentRun: { findUnique: vi.fn().mockResolvedValue(null) },
			runInputSnapshot: { findUnique: vi.fn() },
		} as unknown as PrismaClient;
		const repository = new PrismaRunAdmissionRepository(prisma, undefined, log);

		await expect(repository.admit(_command(), async function _unexpectedBuild() { throw new Error("unexpected build"); })).resolves.toEqual({ outcome: "denied", reason: "persistence_unavailable" });
		expect(error).toHaveBeenCalledWith({ err: duplicateError, runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", failureKind: "transaction_failed" }, "run admission persistence failed");
	});

	it("denies a recovered snapshot that names another execution subject", async function _deniesSnapshotSubjectMismatch()
	{
		const snapshot = { ..._snapshot(), identitySnapshot: { ..._snapshot().identitySnapshot, executionSubjectId: "user-2" } };
		const transaction = { $queryRaw: vi.fn().mockResolvedValue([]), agentRun: { findUnique: vi.fn().mockResolvedValue({ id: snapshot.runId, siloId: snapshot.siloId, agentServiceId: snapshot.agentServiceId, conversationId: snapshot.conversationId, trigger: "Interactive", delegatedUserId: "user-1", inputSnapshotDigest: snapshot.digest }), create: vi.fn() }, runInputSnapshot: { findUnique: vi.fn().mockResolvedValue({ ...snapshot, compiledAt: new Date(snapshot.compiledAt) }), create: vi.fn() }, outboxEvent: { createMany: vi.fn() } };
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
		expect(error).toHaveBeenCalledWith({ err: persistenceError, runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", failureKind: "transaction_failed" }, "run admission persistence failed");
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
		expect(error).toHaveBeenCalledWith({ err: recoveryError, runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", failureKind: "duplicate_recovery_failed" }, "run admission persistence failed");
		expect(error.mock.calls[0]?.[0]).not.toHaveProperty("requestIdempotencyKey");
	});
});
