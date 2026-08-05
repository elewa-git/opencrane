import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaShareAuthorizationUnitOfWork } from "../prisma-share-authorization-unit-of-work.js";

describe("PrismaShareAuthorizationUnitOfWork", function _suite()
{
	it("binds the grant reader and share repository to the same transaction client", async function _bindsRepositories()
	{
		const findMany = vi.fn(async function _findMany() { return []; });
		const transaction = {
			authorizationGrant: { findMany },
		} as unknown as Prisma.TransactionClient;
		const $transaction = vi.fn(async function _transaction<Result>(procedure: (client: Prisma.TransactionClient) => Promise<Result>): Promise<Result>
		{
			return procedure(transaction);
		});
		const unitOfWork = new PrismaShareAuthorizationUnitOfWork({ $transaction } as unknown as PrismaClient);

		await unitOfWork.execute(async function _readGrant(repositories)
		{
			await repositories.grantRepository.listSubjectGrants("silo-1", "user-1");
		});

		expect($transaction).toHaveBeenCalledOnce();
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", subjectId: "user-1" }, orderBy: [{ priority: "desc" }, { id: "asc" }] });
	});
});
