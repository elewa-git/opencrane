import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ___IsRolledBackConflict, ___RunInPrismaUnitOfWork } from "../prisma-unit-of-work";

/** One Prisma conflict error carrying the given code. */
function _Conflict(code: string): Error
{
	return new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "test" });
}

/** Reproduces Prisma's raw-query error with a PostgreSQL SQLSTATE in structured metadata. */
function _rawConflict(code: unknown = "40001"): Error
{
	return new Prisma.PrismaClientKnownRequestError("raw query failed", { code: "P2010", clientVersion: "test", meta: { code } });
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

	it("retries raw-query serialization rollbacks within the existing attempt budget", async function _rawRetry()
	{
		const { prisma, $transaction } = _Prisma();
		const failure = _rawConflict();
		$transaction.mockRejectedValueOnce(failure).mockResolvedValueOnce("done");
		await expect(___RunInPrismaUnitOfWork(prisma, async function _work() { return "done"; }, { isolationLevel: "Serializable", operation: "raw retry", attemptLimit: 2 })).resolves.toBe("done");
		expect($transaction).toHaveBeenCalledTimes(2);
		$transaction.mockClear().mockRejectedValue(failure);
		await expect(___RunInPrismaUnitOfWork(prisma, async function _work() { return "done"; }, { isolationLevel: "Serializable", operation: "raw exhaustion", attemptLimit: 2 })).rejects.toBe(failure);
		expect($transaction).toHaveBeenCalledTimes(2);
	});

	it.each([undefined, new Set(["P2002"]), new Set<string>()])("does not invent a retry budget or expand a narrowed policy: %s", async function _rawPolicy(codes)
	{
		const { prisma, $transaction } = _Prisma();
		const failure = _rawConflict();
		$transaction.mockRejectedValue(failure);
		const policy = codes === undefined ? {} : { attemptLimit: 3, retryableCodes: codes };
		await expect(___RunInPrismaUnitOfWork(prisma, async function _work() { return "done"; }, { isolationLevel: "Serializable", operation: "raw policy", ...policy })).rejects.toBe(failure);
		expect($transaction).toHaveBeenCalledTimes(1);
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

	it("recognises only genuine raw-query serialization evidence under the P2034 policy", function _rawClassification()
	{
		expect(___IsRolledBackConflict(_rawConflict())).toBe(true);
		expect(___IsRolledBackConflict(_rawConflict(), new Set(["P2034"]))).toBe(true);
		expect(___IsRolledBackConflict(_rawConflict(), new Set(["P2002"]))).toBe(false);
		expect(___IsRolledBackConflict(_rawConflict(), new Set(["P2010"]))).toBe(false);
		expect(___IsRolledBackConflict(_rawConflict("40P01"), new Set(["P2010", "P2034"]))).toBe(false);
		for (const error of [_rawConflict("40P01"), _rawConflict("23505"), _rawConflict("08006"), _rawConflict(40001), _rawConflict(null), _Conflict("P2010"), new Error("40001 serialization failure"), { code: "P2010", meta: { code: "40001" } }, new Error("wrapper", { cause: _rawConflict() })])
			expect(___IsRolledBackConflict(error)).toBe(false);
	});
});
