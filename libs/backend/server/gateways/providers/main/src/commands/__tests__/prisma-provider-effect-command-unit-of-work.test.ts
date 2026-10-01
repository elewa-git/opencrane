import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaProviderEffectCommandUnitOfWork } from "../prisma-provider-effect-command-unit-of-work";

/** Builds one Prisma unique-constraint error in either metadata or raw-message form. */
function _uniqueError(constraint: string, shape: "target" | "message"): Prisma.PrismaClientKnownRequestError
{
	const message = shape === "message" ? `Unique constraint failed on the constraint: \`${constraint}\`` : "Unique constraint failed";
	const meta = shape === "target" ? { target: constraint } : { target: ["scope", "cluster_tenant"] };
	return new Prisma.PrismaClientKnownRequestError(message, { code: "P2002", clientVersion: "6.19.3", meta });
}

/** Builds a root client whose first transaction loses a named insert race. */
function _client(error: Error): { readonly prisma: PrismaClient; readonly transaction: ReturnType<typeof vi.fn> }
{
	const transaction = vi.fn()
		.mockRejectedValueOnce(error)
		.mockImplementationOnce(async function _Commit(operation: (client: PrismaClient) => Promise<unknown>) { return operation({} as PrismaClient); });
	return { prisma: { $transaction: transaction } as unknown as PrismaClient, transaction };
}

describe("PrismaProviderEffectCommandUnitOfWork", function _Suite()
{
	it.each(["target", "message"] as const)("retries the named global alias insert race from the %s", async function _RetriesKnownConstraint(shape)
	{
		const client = _client(_uniqueError("model_definitions_global_public_model_name_key", shape));
		const unitOfWork = new PrismaProviderEffectCommandUnitOfWork(client.prisma);

		await expect(unitOfWork.run(async function _Winner() { return "winner"; })).resolves.toBe("winner");
		expect(client.transaction).toHaveBeenCalledTimes(2);
	});

	it("does not retry an unrelated unique conflict", async function _RejectsOtherConstraint()
	{
		const client = _client(_uniqueError("provider_effect_commands_resource_generation_key", "target"));
		const unitOfWork = new PrismaProviderEffectCommandUnitOfWork(client.prisma);

		await expect(unitOfWork.run(async function _Never() { return "unexpected"; })).rejects.toMatchObject({ code: "P2002" });
		expect(client.transaction).toHaveBeenCalledOnce();
	});
});
