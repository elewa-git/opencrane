import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ___IsRolledBackConflict, ___RunInPrismaUnitOfWork } from "../prisma-unit-of-work";

/** One Prisma conflict error carrying the given code. */
function _Conflict(code: string): Error
{
	return new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "test" });
}

/** A fake root client whose $transaction hands the work a marker transaction. */
function _Prisma()
{
	const transaction = { marker: true };
	const $transaction = vi.fn(async function _Run(work: (transaction: unknown) => Promise<unknown>, options: unknown) { void options; return work(transaction); });
	return { prisma: { $transaction } as never, $transaction, transaction };
}

describe("___RunInPrismaUnitOfWork", function _Suite()
{
	it("opens one transaction with the exact declared isolation level and returns the result", async function _Runs()
	{
		const { prisma, $transaction, transaction } = _Prisma();
		const seen: unknown[] = [];

		await expect(___RunInPrismaUnitOfWork(prisma, async function _Work(client) { seen.push(client); return "done"; }, { isolationLevel: "Serializable", operation: "test" })).resolves.toBe("done");
		expect(seen).toEqual([transaction]);
		expect($transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: undefined, maxWait: undefined });
	});

	it("does not retry by default and rethrows the conflict unchanged", async function _NoDefaultRetry()
	{
		const { prisma, $transaction } = _Prisma();
		$transaction.mockRejectedValue(_Conflict("P2034"));

		await expect(___RunInPrismaUnitOfWork(prisma, async function _Work() { return "done"; }, { isolationLevel: "Serializable", operation: "test" })).rejects.toMatchObject({ code: "P2034" });
		expect($transaction).toHaveBeenCalledTimes(1);
	});

	it("retries only proven full rollbacks within the attempt budget", async function _RetriesConflicts()
	{
		const { prisma, $transaction } = _Prisma();
		$transaction.mockRejectedValueOnce(_Conflict("P2034")).mockRejectedValueOnce(_Conflict("P2002")).mockResolvedValueOnce("done");

		await expect(___RunInPrismaUnitOfWork(prisma, async function _Work() { return "done"; }, { isolationLevel: "Serializable", operation: "test", attemptLimit: 3 })).resolves.toBe("done");
		expect($transaction).toHaveBeenCalledTimes(3);
	});

	it("rethrows the last conflict after the final attempt", async function _Exhausts()
	{
		const { prisma, $transaction } = _Prisma();
		$transaction.mockRejectedValue(_Conflict("P2034"));

		await expect(___RunInPrismaUnitOfWork(prisma, async function _Work() { return "done"; }, { isolationLevel: "Serializable", operation: "test", attemptLimit: 2 })).rejects.toMatchObject({ code: "P2034" });
		expect($transaction).toHaveBeenCalledTimes(2);
	});

	it("never retries an unknown failure, and honors a domain retry trigger when given one", async function _DomainTrigger()
	{
		const plain = _Prisma();
		plain.$transaction.mockRejectedValue(new Error("boom"));
		await expect(___RunInPrismaUnitOfWork(plain.prisma, async function _Work() { return "done"; }, { isolationLevel: "Serializable", operation: "test", attemptLimit: 3 })).rejects.toThrow("boom");
		expect(plain.$transaction).toHaveBeenCalledTimes(1);

		const domain = _Prisma();
		domain.$transaction.mockRejectedValueOnce(new Error("domain conflict")).mockResolvedValueOnce("done");
		const isRetryable = function _IsDomainConflict(error: unknown) { return error instanceof Error && error.message === "domain conflict"; };
		await expect(___RunInPrismaUnitOfWork(domain.prisma, async function _Work() { return "done"; }, { isolationLevel: "Serializable", operation: "test", attemptLimit: 2, isRetryable })).resolves.toBe("done");
	});

	it("honors a narrowed retryable-code set", async function _NarrowedCodes()
	{
		const { prisma, $transaction } = _Prisma();
		$transaction.mockRejectedValue(_Conflict("P2002"));

		await expect(___RunInPrismaUnitOfWork(prisma, async function _Work() { return "done"; }, { isolationLevel: "Serializable", operation: "test", attemptLimit: 3, retryableCodes: new Set(["P2034"]) })).rejects.toMatchObject({ code: "P2002" });
		expect($transaction).toHaveBeenCalledTimes(1);
	});

	it("refuses an attempt limit outside 1-10", async function _RefusesBadLimit()
	{
		const { prisma } = _Prisma();
		await expect(___RunInPrismaUnitOfWork(prisma, async function _Work() { return "done"; }, { isolationLevel: "Serializable", operation: "test", attemptLimit: 0 })).rejects.toThrow(/attempt limit between 1 and 10/);
	});

	it("classifies proven rollbacks", function _Classifies()
	{
		expect(___IsRolledBackConflict(_Conflict("P2034"))).toBe(true);
		expect(___IsRolledBackConflict(_Conflict("P2002"))).toBe(true);
		expect(___IsRolledBackConflict(_Conflict("P2025"))).toBe(false);
		expect(___IsRolledBackConflict(new Error("boom"))).toBe(false);
		expect(___IsRolledBackConflict(_Conflict("P0001"), new Set(["P0001"]))).toBe(true);
	});
});
