import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { PrismaSpendUnitOfWork, SpendAuthorizationError } from "../prisma-spend-authority";

/** Builds a central-authority fake with independently controlled read and admission results. */
function _Authorization(allow: boolean): AuthorizationAuthority
{
	const decision = allow
		? { outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow" as const, grantIds: ["grant-1"], rule: null, evidence: null }
		: { outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant" as const, grantIds: [], rule: null, evidence: null };
	return {
		decide: vi.fn().mockResolvedValue(decision),
		admit: vi.fn().mockResolvedValue(decision),
		admitPrincipal: vi.fn().mockResolvedValue(decision),
		admitPrincipalBatch: vi.fn(async function _AdmitBatch(commands) { return commands.map(function _Decision() { return decision; }); }),
		listEntitled: vi.fn(async command => allow ? command.resources : []),
		listPrincipalEntitled: vi.fn(async command => allow ? command.resources : []),
		replaceManagedGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
		retireResourceGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
	};
}

/** Builds a root client whose transaction exposes recording spend delegates. */
function _Prisma()
{
	const transaction = {
		globalBudgetSetting: { findUnique: vi.fn().mockResolvedValue({ id: 1, currency: "USD", ceilingAmount: 25 }), upsert: vi.fn().mockResolvedValue({}) },
		accountBudgetSetting: { findMany: vi.fn().mockResolvedValue([{ userId: "user-1", currency: "USD", ceilingAmount: 10 }]), upsert: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
		tokenUsageSnapshot: { findMany: vi.fn().mockResolvedValue([{ id: 5, userId: "user-1", inputTokens: 2, outputTokens: 3, totalTokens: 5, currency: "USD", totalCost: 1 }]) },
	} as unknown as Prisma.TransactionClient;
	const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: Prisma.TransactionClient) => Promise<unknown>) { return operation(transaction); }) } as unknown as PrismaClient;
	return { prisma, transaction };
}

describe("PrismaSpendUnitOfWork", function _Suite()
{
	it("denies a budget write before persistence when organisation administration is absent", async function _DeniedWrite()
	{
		const { prisma, transaction } = _Prisma();
		const unitOfWork = new PrismaSpendUnitOfWork(prisma, function _AuthorizationFactory() { return _Authorization(false); });

		await expect(unitOfWork.putGlobalBudget({ siloId: "silo-1", principalId: "principal-1" }, { currency: "USD", ceilingAmount: 20 })).rejects.toBeInstanceOf(SpendAuthorizationError);
		expect(transaction.globalBudgetSetting.upsert).not.toHaveBeenCalled();
	});

	it("admits an organisation administration decision in the budget write transaction", async function _AllowedWrite()
	{
		const { prisma, transaction } = _Prisma();
		const authorization = _Authorization(true);
		const unitOfWork = new PrismaSpendUnitOfWork(prisma, function _AuthorizationFactory() { return authorization; });

		await unitOfWork.putGlobalBudget({ siloId: "silo-1", principalId: "principal-1" }, { currency: "USD", ceilingAmount: 20 });

		expect(authorization.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1", resource: { kind: "organization", id: "silo-1" }, action: "administer" }));
		expect(transaction.globalBudgetSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId_id: { siloId: "silo-1", id: 1 } }, create: expect.objectContaining({ siloId: "silo-1", id: 1 }) }));
	});

	it("filters token-usage items through one batch read decision", async function _Usage()
	{
		const { prisma, transaction } = _Prisma();
		const authorization = _Authorization(true);
		const unitOfWork = new PrismaSpendUnitOfWork(prisma, function _AuthorizationFactory() { return authorization; });

		const usage = await unitOfWork.listTokenUsage({ siloId: "silo-1", principalId: "principal-1" });

		expect(usage).toEqual([{ userId: "user-1", inputTokens: 2, outputTokens: 3, totalTokens: 5, currency: "USD", totalCost: 1, budgetCeiling: 10 }]);
		expect(transaction.tokenUsageSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId: "silo-1" } }));
		expect(transaction.globalBudgetSetting.findUnique).toHaveBeenCalledWith({ where: { siloId_id: { siloId: "silo-1", id: 1 } } });
		expect(transaction.accountBudgetSetting.findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1" } });
		expect(authorization.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ resources: [{ kind: "token-usage", id: "5" }], action: "read" }));
	});

	it("uses the caller silo in every account-budget key and query", async function _AccountBudgets()
	{
		const { prisma, transaction } = _Prisma();
		const unitOfWork = new PrismaSpendUnitOfWork(prisma, function _AuthorizationFactory() { return _Authorization(true); });
		const caller = { siloId: "silo-1", principalId: "principal-1" };

		await unitOfWork.listAccountBudgets(caller);
		await unitOfWork.putAccountBudget(caller, "user-1", { currency: "USD", ceilingAmount: 30 });
		await unitOfWork.deleteAccountBudget(caller, "user-1");

		expect(transaction.accountBudgetSetting.findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1" }, orderBy: { userId: "asc" } });
		expect(transaction.accountBudgetSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { siloId_userId: { siloId: "silo-1", userId: "user-1" } }, create: expect.objectContaining({ siloId: "silo-1", userId: "user-1" }) }));
		expect(transaction.accountBudgetSetting.deleteMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", userId: "user-1" } });
	});
});
