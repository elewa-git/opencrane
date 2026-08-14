import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaSkillWorkloadUnitOfWork } from "../prisma-skill-workload-unit-of-work";
import { _CreateSkillWorkloadExecutionAuthority } from "../skill-workload-authority";
import { _SkillWorkloadPersistenceConflictError } from "../skill-workload-unit-of-work.types";

/** Builds a fake PrismaClient that gives each `run` call a fresh transaction. */
function _Prisma()
{
	const firstTransaction = {};
	const secondTransaction = {};
	const transactions = [firstTransaction, secondTransaction];
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (transaction: unknown) => Promise<unknown>): Promise<unknown> { const transaction = transactions.shift(); return work(transaction); }) };
	return { prisma, firstTransaction, secondTransaction };
}

describe("Prisma skill workload unit of work", function _DescribeUnitOfWork()
{
	it("binds fresh transaction-scoped repositories for each complete authority operation", async function _BindsFreshTransactions()
	{
		const { prisma, firstTransaction, secondTransaction } = _Prisma();
		const unitOfWork = new PrismaSkillWorkloadUnitOfWork(prisma as never, 30_000);
		const firstAssignments = await unitOfWork.run(async function _First(transaction): Promise<object> { return transaction.assignments as object; });
		const secondAssignments = await unitOfWork.run(async function _Second(transaction): Promise<object> { return transaction.assignments as object; });

		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(firstAssignments).not.toBe(secondAssignments);
		expect(firstTransaction).not.toBe(secondTransaction);
		expect(prisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	});

	it("retries a fresh serializable transaction after commit-time contention", async function _RetriesCommitConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		let attempts = 0;
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (transaction: unknown) => Promise<unknown>): Promise<unknown>
		{
			attempts += 1;
			const result = await work({});
			if (attempts < 3) throw conflict;
			return result;
		}) };
		const unitOfWork = new PrismaSkillWorkloadUnitOfWork(prisma as never, 30_000);

		await expect(unitOfWork.run(async function _Work(): Promise<"assigned"> { return "assigned"; })).resolves.toBe("assigned");
		expect(prisma.$transaction).toHaveBeenCalledTimes(3);
	});

	it("translates contention only after bounded serializable retries are exhausted", async function _TranslatesExhaustedConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const prisma = { $transaction: vi.fn().mockRejectedValue(conflict) };
		const unitOfWork = new PrismaSkillWorkloadUnitOfWork(prisma as never, 30_000);

		await expect(unitOfWork.run(async function _Work(): Promise<"assigned"> { return "assigned"; })).rejects.toBeInstanceOf(_SkillWorkloadPersistenceConflictError);
		expect(prisma.$transaction).toHaveBeenCalledTimes(3);
	});

	it("maps a rolled-back persistence conflict to the assignment conflict contract", async function _MapsAssignmentConflict()
	{
		const unitOfWork = { run: vi.fn().mockRejectedValue(new _SkillWorkloadPersistenceConflictError("rolled back")) };
		const authority = _CreateSkillWorkloadExecutionAuthority(unitOfWork as never);

		await expect(authority.commitAssignmentAtomically("workload-1", {} as never)).resolves.toBe("conflict");
	});
});
