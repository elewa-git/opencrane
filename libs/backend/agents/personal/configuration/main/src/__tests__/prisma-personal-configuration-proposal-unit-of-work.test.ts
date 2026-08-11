import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";
import { PrismaPersonalConfigurationProposalRepository } from "../proposal/prisma-personal-configuration-proposal-repository.js";
import { PrismaPersonalConfigurationProposalUnitOfWork } from "../proposal/prisma-personal-configuration-proposal-unit-of-work.js";

describe("Prisma personal configuration proposal UoW", function _PrismaPersonalConfigurationProposalUnitOfWorkSuite()
{
	it("constructs the proposal repository inside the owning transaction", async function _ConstructsTransactionRepository()
	{
		const transaction = {};
		const prisma = { $transaction: vi.fn(async function _RunTransaction(callback: (value: unknown) => Promise<unknown>) { return callback(transaction); }) };
		const unitOfWork = new PrismaPersonalConfigurationProposalUnitOfWork(prisma as never);
		const result = await unitOfWork.run(async function _Inspect(repositories)
		{
			expect(repositories.proposals).toBeInstanceOf(PrismaPersonalConfigurationProposalRepository);
			return "completed";
		});

		expect(result).toBe("completed");
		expect(prisma.$transaction).toHaveBeenCalledOnce();
	});

	it("maps the database provenance trigger to a fail-closed domain result", async function _MapsProvenanceConflict()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("proposal provenance conflict", { code: "P0001", clientVersion: "test" });
		const logger = { error: vi.fn() };
		const prisma = { $transaction: vi.fn().mockRejectedValue(conflict) };
		const unitOfWork = new PrismaPersonalConfigurationProposalUnitOfWork(prisma as never, logger as never);

		await expect(unitOfWork.proposeAtomically({ siloId: "silo-1", userId: "user-1", sourceRunId: "run-1" } as never)).resolves.toEqual({ status: PersonalConfigurationProposalCodes.ProvenanceConflict });
		expect(logger.error).toHaveBeenCalledOnce();
	});

	it("maps an unexpected transaction fault to persistence unavailability", async function _MapsPersistenceFailure()
	{
		const logger = { error: vi.fn() };
		const prisma = { $transaction: vi.fn().mockRejectedValue(new Error("connection unavailable")) };
		const unitOfWork = new PrismaPersonalConfigurationProposalUnitOfWork(prisma as never, logger as never);

		await expect(unitOfWork.proposeAtomically({ siloId: "silo-1", userId: "user-1", sourceRunId: "run-1" } as never)).resolves.toEqual({ status: PersonalConfigurationProposalCodes.PersistenceUnavailable });
		expect(logger.error).toHaveBeenCalledOnce();
	});
});
