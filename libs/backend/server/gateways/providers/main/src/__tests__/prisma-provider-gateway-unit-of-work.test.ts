import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ProviderGatewayAuthorizationFactory } from "../provider-gateway-authority.types";
import { PrismaProviderGatewayUnitOfWork } from "../prisma-provider-gateway-unit-of-work";

/** Builds a minimal central authority factory for transaction-boundary tests. */
function _AuthorizationFactory(): ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>
{
	return (function _CreateAuthorization() { return {}; }) as unknown as ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>;
}

describe("provider gateway transaction boundaries", function _Suite()
{
	it("never retries an effect-capable callback after a P2034", async function _DoNotRetryEffects()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const transaction = {} as Prisma.TransactionClient;
		const prisma = {
			$transaction: vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown>
			{
				await work(transaction);
				throw conflict;
			}),
		} as unknown as PrismaClient;
		const unitOfWork = new PrismaProviderGatewayUnitOfWork(prisma, _AuthorizationFactory());
		const effectCapableWork = vi.fn(async function _EffectCapableWork() { return "attempted"; });

		await expect(unitOfWork.run(effectCapableWork)).rejects.toBe(conflict);

		expect(prisma.$transaction).toHaveBeenCalledOnce();
		expect(effectCapableWork).toHaveBeenCalledOnce();
	});

	it("retries only the database mutation boundary with Serializable options", async function _RetryDatabaseMutation()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("serialization conflict", { code: "P2034", clientVersion: "test" });
		const transaction = {} as Prisma.TransactionClient;
		let attempt = 0;
		const prisma = {
			$transaction: vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<string>, options: unknown): Promise<string>
			{
				expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
				const result = await work(transaction);
				attempt += 1;
				if (attempt === 1)
				{
					throw conflict;
				}
				return result;
			}),
		} as unknown as PrismaClient;
		const unitOfWork = new PrismaProviderGatewayUnitOfWork(prisma, _AuthorizationFactory());
		const databaseWork = vi.fn(async function _DatabaseWork() { return "committed"; });

		await expect(unitOfWork.runDatabaseMutation(databaseWork)).resolves.toBe("committed");

		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(databaseWork).toHaveBeenCalledTimes(2);
	});
});
