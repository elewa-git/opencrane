import { describe, expect, it, vi } from "vitest";

import { PrismaSkillWorkloadUnitOfWork } from "../prisma-skill-workload-unit-of-work.js";

/** Builds one root-client double that exposes a fresh transaction to each unit-of-work call. */
function _Prisma()
{
	const firstTransaction = { $queryRaw: vi.fn().mockResolvedValue([]) };
	const secondTransaction = { $queryRaw: vi.fn().mockResolvedValue([]) };
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
		const firstAssignments = await unitOfWork.run(async function _First(transaction): Promise<object> { await transaction.assignments.claimNext(); return transaction.assignments as object; });
		const secondAssignments = await unitOfWork.run(async function _Second(transaction): Promise<object> { await transaction.assignments.claimNext(); return transaction.assignments as object; });

		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(firstAssignments).not.toBe(secondAssignments);
		expect(firstTransaction.$queryRaw).toHaveBeenCalledOnce();
		expect(secondTransaction.$queryRaw).toHaveBeenCalledOnce();
	});
});
