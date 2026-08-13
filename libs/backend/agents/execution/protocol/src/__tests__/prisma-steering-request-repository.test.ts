import { AgentRunState, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaSteeringRequestRepository } from "../prisma-steering-request-repository.js";
import { PrismaSteeringRequestUnitOfWork } from "../prisma-steering-request-unit-of-work.js";

/** Owner-bound steering request reused across transaction and retry assertions. */
const _COMMAND = { runId: "run-1", siloId: "silo-1", subjectId: "user-1", content: { text: "Focus." }, idempotencyDigest: "sha256:key", digest: "sha256:key:sha256:text", submittedAt: new Date("2026-07-26T12:00:00.000Z") } as const;

/** Build the smallest transaction double used by the owner-bound steering queue. */
function _transaction(priorResume: boolean, priorSteering: { readonly id: string; readonly runId: string; readonly siloId: string; readonly subjectId: string; readonly attempt: number; readonly digest: string } | null = null)
{
	const create = vi.fn();
	return {
		agentRun: { findFirst: vi.fn().mockResolvedValue({ attempt: 3, state: AgentRunState.Running }) },
		runtimeDispatchedCommand: { findFirst: vi.fn().mockResolvedValue(priorResume ? { id: "resume-1" } : null) },
		runtimeSteeringRequest: { findUnique: vi.fn().mockResolvedValue(priorSteering), create },
	};
}

describe("PrismaSteeringRequestRepository", function _suite()
{
	it("refuses a later request once the attempt has minted its sole resume", async function _refusesLaterRequest()
	{
		const transaction = _transaction(true);
		const repository = new PrismaSteeringRequestRepository(transaction as never);
		await expect(repository.submit(_COMMAND, "steering-id")).resolves.toEqual({ outcome: "run_not_steerable" });
		expect(transaction.runtimeSteeringRequest.create).not.toHaveBeenCalled();
	});

	it("returns the existing row for an exact retry without queueing twice", async function _ReturnsIdempotent()
	{
		const transaction = _transaction(false, { id: "steer-1", runId: "run-1", siloId: "silo-1", subjectId: "user-1", attempt: 3, digest: "sha256:key:sha256:text" });
		const repository = new PrismaSteeringRequestRepository(transaction as never);

		await expect(repository.submit(_COMMAND, "steer-1")).resolves.toEqual({ outcome: "idempotent", steeringRequestId: "steer-1", attempt: 3 });
		expect(transaction.runtimeSteeringRequest.create).not.toHaveBeenCalled();
	});

	it("reads the committed same-digest winner after three rolled-back conflicts", async function _ReadsSameDigestWinner()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const winner = { id: "stored-id", runId: "run-1", siloId: "silo-1", subjectId: "user-1", attempt: 3, digest: _COMMAND.digest };
		const winnerTransaction = _transaction(false, winner);
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockImplementationOnce(async function _Read(work) { return work(winnerTransaction); }) };

		await expect(new PrismaSteeringRequestUnitOfWork(prisma as never).submitAtomically(_COMMAND)).resolves.toEqual({ outcome: "idempotent", steeringRequestId: "stored-id", attempt: 3 });
		expect(prisma.$transaction).toHaveBeenCalledTimes(4);
	});

	it("reports conflict when the deterministic winner has different content", async function _ReadsDifferentDigestWinner()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("unique conflict", { code: "P2002", clientVersion: "test" });
		const winner = { id: "stored-id", runId: "run-1", siloId: "silo-1", subjectId: "user-1", attempt: 3, digest: "sha256:key:sha256:other" };
		const winnerTransaction = _transaction(false, winner);
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockImplementationOnce(async function _Read(work) { return work(winnerTransaction); }) };

		await expect(new PrismaSteeringRequestUnitOfWork(prisma as never).submitAtomically(_COMMAND)).resolves.toEqual({ outcome: "idempotency_conflict" });
	});

	it("rethrows the third conflict when no deterministic winner committed", async function _ExhaustsRetries()
	{
		const first = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const last = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const emptyTransaction = _transaction(false, null);
		const prisma = { $transaction: vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(first).mockRejectedValueOnce(last).mockImplementationOnce(async function _Read(work) { return work(emptyTransaction); }) };

		await expect(new PrismaSteeringRequestUnitOfWork(prisma as never).submitAtomically(_COMMAND)).rejects.toBe(last);
		expect(prisma.$transaction).toHaveBeenCalledTimes(4);
	});
});
