import express, { type Express } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { aiBudgetRouter } from "../routes/ai-budget";
import { tokenUsageRouter } from "../routes/token-usage";
import { _SpendOpenapiPaths, _SpendOpenapiSchemas } from "../openapi";

const _CALLER = { siloId: "silo-1", principalId: "principal-1" };

/** Builds an authority fixture that exposes every candidate usage row. */
function _Authorization(): AuthorizationAuthority
{
	const decision = { outcome: AuthorizationDecisionOutcomes.Allow, reason: "winning_allow" as const, grantIds: ["grant-1"], rule: null, evidence: null };
	return {
		decide: vi.fn().mockResolvedValue(decision),
		decidePrincipal: vi.fn().mockResolvedValue(decision),
		admit: vi.fn().mockResolvedValue(decision),
		admitPrincipal: vi.fn().mockResolvedValue(decision),
		admitPrincipalBatch: vi.fn(async function _AdmitBatch(commands) { return commands.map(function _Decision() { return decision; }); }),
		listEntitled: vi.fn(async command => command.resources),
		listPrincipalEntitled: vi.fn(async command => command.resources),
		replaceManagedGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
		retireResourceGrants: vi.fn().mockResolvedValue({ ...decision, changedCount: 0 }),
	};
}

/** Creates a transaction-backed Prisma fixture for public spend route assertions. */
function _Prisma(): { prisma: PrismaClient; transaction: { globalBudgetSetting: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }; accountBudgetSetting: { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> }; tokenUsageSnapshot: { findMany: ReturnType<typeof vi.fn> } } }
{
	const transaction = {
		globalBudgetSetting: { findUnique: vi.fn().mockResolvedValue({ id: 1, currency: "USD", ceilingAmount: 0 }), upsert: vi.fn().mockResolvedValue({}) },
		accountBudgetSetting: { findMany: vi.fn().mockResolvedValue([{ userId: "user-3", currency: "EUR", ceilingAmount: 4.5 }]), upsert: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
		tokenUsageSnapshot: { findMany: vi.fn().mockResolvedValue([
			{ id: 1, userId: "user-1", inputTokens: 2, outputTokens: 3, totalTokens: 5, currency: "USD", totalCost: 1 },
			{ id: 2, userId: "user-2", inputTokens: 0, outputTokens: 7, totalTokens: 7, currency: "EUR", totalCost: 2.5 },
		]) },
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(operation: (client: Prisma.TransactionClient) => Promise<unknown>) { return operation(transaction as unknown as Prisma.TransactionClient); }) } as unknown as PrismaClient;
	return { prisma, transaction };
}

/** Mounts the real spend routers under the same public API prefixes as the server. */
function _App(prisma: PrismaClient, caller: typeof _CALLER | null = _CALLER): Express
{
	const app = express();
	app.use(express.json());
	app.use("/api/v1/ai-budget", aiBudgetRouter(prisma, function _ResolveCaller() { return caller; }, function _CreateAuthorization() { return _Authorization(); }));
	app.use("/api/v1/token-usage", tokenUsageRouter(prisma, function _ResolveCaller() { return caller; }, function _CreateAuthorization() { return _Authorization(); }));
	return app;
}

describe("spend OpenAPI and public route contract", function _Suite()
{
	it("registers truthful schemas, paths, required fields, and status responses", function _DescribesContract()
	{
		expect(_SpendOpenapiPaths["/token-usage"].get.responses[200].content["application/json"].schema).toEqual({ type: "array", items: { $ref: "#/components/schemas/TokenUsage" } });
		expect(_SpendOpenapiSchemas.TokenUsage.required).toEqual(["userId", "inputTokens", "outputTokens", "totalTokens", "currency", "totalCost"]);
		expect(_SpendOpenapiSchemas.TokenUsage.properties.budgetCeiling.type).toBe("number");
		expect(_SpendOpenapiSchemas.TokenUsage.properties.budgetCeiling).not.toHaveProperty("nullable");
		expect(_SpendOpenapiSchemas.Budget.required).toEqual(["currency", "ceilingAmount"]);
		expect(_SpendOpenapiSchemas.AccountBudget.required).toEqual(["userId", "currency", "ceilingAmount"]);
		const budgetWriteSchema = _SpendOpenapiPaths["/ai-budget/global"].put.requestBody.content["application/json"].schema;
		expect(budgetWriteSchema).not.toHaveProperty("required");
		expect(budgetWriteSchema.properties.currency.default).toBe("USD");
		expect(budgetWriteSchema.properties.ceilingAmount.default).toBe(0);
		expect(_SpendOpenapiPaths["/ai-budget/global"].put.responses[204]).toEqual({ description: "Global budget updated; the response has no body." });
		expect(_SpendOpenapiPaths["/ai-budget/accounts/{userId}"].delete.responses[204]).toEqual({ description: "Account budget removed; the response has no body." });
		for (const path of Object.values(_SpendOpenapiPaths))
		{
			for (const operation of Object.values(path))
			{
				expect(operation.responses).toHaveProperty("403");
				expect(operation.responses).toHaveProperty("500");
			}
		}
	});

	it("matches zero ceilings, multiple currencies, and omitted unmatched ceilings", async function _MatchesRuntimeRows()
	{
		const { prisma } = _Prisma();
		const response = await request(_App(prisma)).get("/api/v1/token-usage").expect(200);

		expect(response.body).toEqual([
			{ userId: "user-1", inputTokens: 2, outputTokens: 3, totalTokens: 5, currency: "USD", totalCost: 1, budgetCeiling: 0 },
			{ userId: "user-2", inputTokens: 0, outputTokens: 7, totalTokens: 7, currency: "EUR", totalCost: 2.5 },
		]);
		expect(response.body[0]).toMatchObject({ currency: "USD", budgetCeiling: 0 });
		expect(response.body[1]).toMatchObject({ currency: "EUR" });
		expect(response.body[1]).not.toHaveProperty("budgetCeiling");
	});

	it("matches budget reads and no-content writes", async function _MatchesBudgetRoutes()
	{
		const { prisma, transaction } = _Prisma();

		await request(_App(prisma)).get("/api/v1/ai-budget/global").expect(200).expect({ currency: "USD", ceilingAmount: 0 });
		await request(_App(prisma)).get("/api/v1/ai-budget/accounts").expect(200).expect([{ userId: "user-3", currency: "EUR", ceilingAmount: 4.5 }]);
		await request(_App(prisma)).put("/api/v1/ai-budget/global").send({}).expect(204).expect("");
		await request(_App(prisma)).put("/api/v1/ai-budget/global").send({ currency: "eur", ceilingAmount: 0 }).expect(204).expect("");
		await request(_App(prisma)).delete("/api/v1/ai-budget/accounts/user-3").expect(204).expect("");

		expect(transaction.globalBudgetSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { currency: "USD", ceilingAmount: 0 } }));
		expect(transaction.globalBudgetSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { currency: "EUR", ceilingAmount: 0 } }));
		expect(transaction.accountBudgetSetting.deleteMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", userId: "user-3" } });
	});

	it("returns the documented forbidden status when no Principal is available", async function _FailsClosed()
	{
		const { prisma } = _Prisma();
		await request(_App(prisma, null)).get("/api/v1/token-usage").expect(403).expect({ error: "Authenticated Principal is required", code: "FORBIDDEN" });
		await request(_App(prisma, null)).get("/api/v1/ai-budget/global").expect(403).expect({ error: "Authenticated Principal is required", code: "FORBIDDEN" });
	});
});
