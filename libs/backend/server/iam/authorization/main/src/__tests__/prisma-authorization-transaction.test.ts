import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "../authorization-authority.types";
import { ___RunSerializableAuthorizationTransaction } from "../prisma-authorization-transaction";

/** Builds one Prisma known-request error with the requested database code. */
function _PrismaError(code: string): Prisma.PrismaClientKnownRequestError
{
	return new Prisma.PrismaClientKnownRequestError("transaction conflict", { code, clientVersion: "test" });
}

describe("serializable authorization transactions", function _Suite()
{
	it("retries a P2034 with a fresh Serializable transaction and authority", async function _RetrySerializationConflict()
	{
		const conflict = _PrismaError("P2034");
		const transactions = [{ id: "transaction-1" }, { id: "transaction-2" }] as unknown as Prisma.TransactionClient[];
		let attempt = 0;
		const transactionOptions: unknown[] = [];
		const prisma = {
			$transaction: vi.fn(async function _Transaction(work: (transaction: Prisma.TransactionClient) => Promise<string>, options: unknown): Promise<string>
			{
				transactionOptions.push(options);
				const result = await work(transactions[attempt]);
				attempt += 1;
				if (attempt === 1)
				{
					throw conflict;
				}
				return result;
			}),
		} as unknown as PrismaClient;
		const authorities: AuthorizationAuthority[] = [];
		const createAuthorization = vi.fn(function _CreateAuthorization(transaction: Prisma.TransactionClient): AuthorizationAuthority
		{
			const authorization = { transaction } as unknown as AuthorizationAuthority;
			authorities.push(authorization);
			return authorization;
		});
		const observed: Array<{ readonly transaction: Prisma.TransactionClient; readonly authorization: AuthorizationAuthority }> = [];

		const result = await ___RunSerializableAuthorizationTransaction(prisma, async function _Work(transaction, authorization)
		{
			observed.push({ transaction, authorization });
			return "committed";
		}, createAuthorization);

		expect(result).toBe("committed");
		expect(transactionOptions).toEqual([
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
		]);
		expect(createAuthorization).toHaveBeenCalledTimes(2);
		expect(observed).toEqual([
			{ transaction: transactions[0], authorization: authorities[0] },
			{ transaction: transactions[1], authorization: authorities[1] },
		]);
		expect(authorities[0]).not.toBe(authorities[1]);
	});

	it("rethrows the third P2034 unchanged after the bounded retry budget", async function _ExhaustSerializationConflicts()
	{
		const conflict = _PrismaError("P2034");
		const transaction = {} as Prisma.TransactionClient;
		const prisma = {
			$transaction: vi.fn(async function _Transaction(work: (transaction: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown>
			{
				await work(transaction);
				throw conflict;
			}),
		} as unknown as PrismaClient;
		const work = vi.fn(async function _Work() { return "rolled-back"; });

		await expect(___RunSerializableAuthorizationTransaction(prisma, work)).rejects.toBe(conflict);

		expect(prisma.$transaction).toHaveBeenCalledTimes(3);
		expect(work).toHaveBeenCalledTimes(3);
	});

	it("does not retry a Prisma failure that is not P2034", async function _RejectNonSerializationFailure()
	{
		const conflict = _PrismaError("P2002");
		const prisma = { $transaction: vi.fn().mockRejectedValue(conflict) } as unknown as PrismaClient;
		const work = vi.fn(async function _Work() { return "not-run"; });

		await expect(___RunSerializableAuthorizationTransaction(prisma, work)).rejects.toBe(conflict);

		expect(prisma.$transaction).toHaveBeenCalledOnce();
		expect(work).not.toHaveBeenCalled();
	});
});
