import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAgentRunAuthorityRepository } from "../prisma-run-authority.js";
import type { AtomicStartNextRunAttemptCommand } from "../run-authority.types.js";

/** Creates one participant-authorized atomic retry command. */
function _command(): AtomicStartNextRunAttemptCommand
{
	return { runId: "run-1", expectedAttempt: 1, siloId: "silo-1", conversationId: "conversation-1", requestedBy: "user-1", idempotencyKey: "retry-1", expectedAgentServiceId: "service-1", expectedAgentServiceSiloId: "silo-1", expectedAgentServiceState: "active", expectedActiveAgentRevisionId: "revision-1", acceptedAt: "2026-07-18T01:00:00.000Z" };
}

/** Creates one retryable Prisma run row. */
function _runRow()
{
	return { id: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", conversationId: "conversation-1", trigger: "Interactive", delegatedUserId: "user-1", requestIdempotencyKey: "request-1", rootRunId: "run-1", parentRunId: null, attempt: 1, state: "Failed", effectiveContractDigest: `sha256:${"1".repeat(64)}`, inputSnapshotDigest: `sha256:${"2".repeat(64)}`, acceptedAt: new Date("2026-07-18T00:00:00.000Z"), startedAt: new Date("2026-07-18T00:01:00.000Z"), finishedAt: new Date("2026-07-18T00:02:00.000Z"), terminalReason: "RuntimeFailure", costAmount: null, costCurrency: null };
}

/** Creates the exact Active service authority required by a retry. */
function _serviceRow()
{
	return { id: "service-1", siloId: "silo-1", state: "Active", activeRevisionId: "revision-1" };
}

/** Creates the current participant and membership delegates for a retry transaction. */
function _authority()
{
	return { orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "member-1" }) }, conversationParticipant: { findFirst: vi.fn().mockResolvedValue({ conversationId: "conversation-1" }) } };
}

describe("Prisma AgentRun authority adapter", function _suite()
{
	it("commits a single next attempt and its outbox event atomically", async function _retry()
	{
		const run = _runRow();
		const outboxCreate = vi.fn().mockResolvedValue({ id: "outbox-1" });
		const transaction = { ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) }, agentRun: { findUnique: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, attempt: 2, state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, outboxEvent: { findUnique: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 3 } }), create: outboxCreate } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;

		const result = await new PrismaAgentRunAuthorityRepository(prisma).startNextAttemptAtomically(_command());

		expect(result.status).toBe("started");
		expect(transaction.agentRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", state: { in: ["Failed", "Cancelled"] } }) }));
		expect(outboxCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ attempt: 2, sequence: 4, idempotencyKey: "run-1:attempt:2", payload: { runId: "run-1", attempt: 2, requestedBy: "user-1", retryIdempotencyKey: "retry-1" } }) });
	});

	it("denies a retry before mutation when current participant authority is absent", async function _Unauthorized()
	{
		const transaction = { ..._authority(), agentService: { findUnique: vi.fn() }, agentRun: { findUnique: vi.fn(), updateMany: vi.fn() }, outboxEvent: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() } };
		transaction.conversationParticipant.findFirst.mockResolvedValue(null);
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;

		await expect(new PrismaAgentRunAuthorityRepository(prisma).startNextAttemptAtomically(_command())).resolves.toEqual({ status: "unauthorized" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("replays only the same durable retry key for the next attempt", async function _Idempotency()
	{
		const run = { ..._runRow(), attempt: 2, state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null };
		const transaction = { ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) }, agentRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn() }, outboxEvent: { findUnique: vi.fn().mockResolvedValue({ payload: { runId: "run-1", attempt: 2, requestedBy: "user-1", retryIdempotencyKey: "retry-1" } }), aggregate: vi.fn(), create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentRunAuthorityRepository(prisma);

		await expect(repository.startNextAttemptAtomically(_command())).resolves.toMatchObject({ status: "idempotent", run: { attempt: 2 } });
		await expect(repository.startNextAttemptAtomically({ ..._command(), idempotencyKey: "retry-other" })).resolves.toEqual({ status: "attempt_conflict", currentAttempt: 2 });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
	});

	it("returns the same retry when another transaction wins the conditional update", async function _ConcurrentIdempotency()
	{
		const initial = _runRow();
		const updated = { ...initial, attempt: 2, state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null };
		const transaction = { ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) }, agentRun: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(updated), updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, outboxEvent: { findUnique: vi.fn().mockResolvedValue({ payload: { runId: "run-1", attempt: 2, requestedBy: "user-1", retryIdempotencyKey: "retry-1" } }), aggregate: vi.fn(), create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;

		await expect(new PrismaAgentRunAuthorityRepository(prisma).startNextAttemptAtomically(_command())).resolves.toMatchObject({ status: "idempotent", run: { attempt: 2 } });
		expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
	});

	it("does not mutate when the service authority changed", async function _serviceConflict()
	{
		const transaction = { ..._authority(), agentService: { findUnique: vi.fn().mockResolvedValue({ ..._serviceRow(), activeRevisionId: "revision-2" }) }, agentRun: { findUnique: vi.fn().mockResolvedValue(_runRow()), updateMany: vi.fn() }, outboxEvent: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() } };
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;

		await expect(new PrismaAgentRunAuthorityRepository(prisma).startNextAttemptAtomically(_command())).resolves.toEqual({ status: "agent_service_authority_conflict", currentAgentServiceState: "active", currentAgentServiceSiloId: "silo-1", currentActiveAgentRevisionId: "revision-2" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
	});
});
