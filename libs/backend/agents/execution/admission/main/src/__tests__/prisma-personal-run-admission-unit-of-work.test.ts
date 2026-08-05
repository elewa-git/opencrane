import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PersonalRunIdempotencyOutcomes, type PersonalRunAdmissionCommand } from "../personal-run-admission.types.js";
import { PrismaPersonalRunAdmissionUnitOfWork } from "../prisma-personal-run-admission-unit-of-work.js";

/** Builds one trusted personal admission command for persistence-adapter tests. */
function _Command(): PersonalRunAdmissionCommand
{
	return { siloId: "silo-1", executionSubjectId: "user-1", threadId: "thread-1", requestIdempotencyKey: "request-1" };
}

/** Builds a Prisma-shaped client that exposes one exact serializable transaction snapshot. */
function _Client(transaction: object): never
{
	return {
		$transaction: async function _Transaction(work: (client: object) => Promise<unknown>, options: { readonly isolationLevel: Prisma.TransactionIsolationLevel })
		{
			expect(options.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable);
			return work(transaction);
		},
	} as never;
}

describe("PrismaPersonalRunAdmissionUnitOfWork", function _DescribePrismaPersonalRunAdmissionUnitOfWork()
{
	it("resolves an exact durable duplicate from one serializable authority snapshot", async function _ResolvesDuplicate()
	{
		const transaction = {
			agentRun: {
				findUnique: async function _FindUnique()
				{
					return { id: "run-1", threadId: "thread-1", delegatedUserId: "user-1", trigger: "Interactive", inputSnapshot: { id: "snapshot-1" } };
				},
			},
		};
		const unitOfWork = new PrismaPersonalRunAdmissionUnitOfWork(_Client(transaction));

		await expect(unitOfWork.resolve(_Command())).resolves.toEqual({ outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: "run-1" });
	});

	it("resolves only a participant-bound personal service inside a serializable snapshot", async function _ResolvesPersonalThread()
	{
		const transaction = {
			conversationThread: { findFirst: async function _FindThread() { return { agentServiceId: "service-1" }; } },
			agentService: { findFirst: async function _FindService() { return { id: "service-1" }; } },
		};
		const unitOfWork = new PrismaPersonalRunAdmissionUnitOfWork(_Client(transaction));

		await expect(unitOfWork.resolveThread(_Command())).resolves.toEqual({ agentServiceId: "service-1" });
	});
});
