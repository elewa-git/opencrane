import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaAgentRunAuthorityRepository } from "../prisma-run-authority.js";

/** Creates one retryable Prisma run row. */
function _runRow()
{
	return {
		id: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		threadId: null,
		trigger: "Interactive",
		delegatedUserId: "user-1",
		requestIdempotencyKey: "request-1",
		rootRunId: "run-1",
		parentRunId: null,
		attempt: 1,
		state: "Failed",
		effectiveContractDigest: `sha256:${"1".repeat(64)}`,
		inputSnapshotDigest: `sha256:${"2".repeat(64)}`,
		acceptedAt: new Date("2026-07-18T00:00:00.000Z"),
		startedAt: new Date("2026-07-18T00:01:00.000Z"),
		finishedAt: new Date("2026-07-18T00:02:00.000Z"),
		terminalReason: "RuntimeFailure",
		costAmount: null,
		costCurrency: null,
	};
}

/** Creates the exact Active service authority required by a retry. */
function _serviceRow()
{
	return { id: "service-1", siloId: "silo-1", state: "Active", activeRevisionId: "revision-1" };
}

describe("Prisma AgentRun authority adapter", function _suite()
{
	it("commits a single next attempt and its outbox event atomically", async function _retry()
	{
		const run = _runRow();
		const outboxCreate = vi.fn().mockResolvedValue({ id: "outbox-1" });
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			agentService: { findUnique: vi.fn().mockResolvedValue(_serviceRow()) },
			agentRun: {
				findUnique: vi.fn().mockResolvedValue(run),
				update: vi.fn().mockResolvedValue({ ...run, attempt: 2, state: "Accepted", acceptedAt: new Date("2026-07-18T01:00:00.000Z"), startedAt: null, finishedAt: null, terminalReason: null }),
			},
			outboxEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 3 } }), create: outboxCreate },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentRunAuthorityRepository(prisma);

		const result = await repository.startNextAttemptAtomically({ runId: "run-1", expectedAttempt: 1, expectedAgentServiceId: "service-1", expectedAgentServiceSiloId: "silo-1", expectedAgentServiceState: "active", expectedActiveAgentRevisionId: "revision-1", acceptedAt: "2026-07-18T01:00:00.000Z" });

		expect(result.status).toBe("started");
		expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
		expect(outboxCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ attempt: 2, sequence: 4, idempotencyKey: "run-1:attempt:2" }) });
	});

	it("does not mutate when the locked service authority changed", async function _serviceConflict()
	{
		const transaction = {
			$queryRaw: vi.fn().mockResolvedValue([]),
			agentService: { findUnique: vi.fn().mockResolvedValue({ ..._serviceRow(), activeRevisionId: "revision-2" }) },
			agentRun: { findUnique: vi.fn().mockResolvedValue(_runRow()), update: vi.fn() },
			outboxEvent: { aggregate: vi.fn(), create: vi.fn() },
		};
		const prisma = { $transaction: vi.fn(async function _transaction(callback: (client: typeof transaction) => Promise<unknown>) { return callback(transaction); }) } as unknown as PrismaClient;
		const repository = new PrismaAgentRunAuthorityRepository(prisma);

		await expect(repository.startNextAttemptAtomically({ runId: "run-1", expectedAttempt: 1, expectedAgentServiceId: "service-1", expectedAgentServiceSiloId: "silo-1", expectedAgentServiceState: "active", expectedActiveAgentRevisionId: "revision-1", acceptedAt: "2026-07-18T01:00:00.000Z" })).resolves.toEqual({ status: "agent_service_authority_conflict", currentAgentServiceState: "active", currentAgentServiceSiloId: "silo-1", currentActiveAgentRevisionId: "revision-2" });
		expect(transaction.agentRun.update).not.toHaveBeenCalled();
		expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
	});
});
