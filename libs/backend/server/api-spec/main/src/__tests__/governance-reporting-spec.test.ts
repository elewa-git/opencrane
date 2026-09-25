import { describe, expect, it } from "vitest";

import { spec } from "../spec";

describe("governance reporting API composition", function _Suite()
{
	it("publishes recorded usage without the retired model and monthly-USD projection", function _Usage()
	{
		expect(spec.paths["/token-usage"].get.responses[200].content["application/json"].schema).toEqual({ type: "array", items: { $ref: "#/components/schemas/TokenUsage" } });
		expect(spec.components.schemas.TokenUsage.required).toEqual(["userId", "inputTokens", "outputTokens", "totalTokens", "currency", "totalCost"]);
		expect(spec.components.schemas.TokenUsage.properties).toHaveProperty("budgetCeiling");
		expect(spec.components.schemas.TokenUsage.properties).not.toHaveProperty("totalCostUsd");
		expect(spec.components.schemas.TokenUsage.properties).not.toHaveProperty("recordedAt");
	});

	it("registers required audit fields and the actual budget mutation outcomes", function _AuditAndBudgets()
	{
		expect(spec.components.schemas.AuditEntry.required).toEqual(["timestamp", "action", "resource", "message"]);
		expect(spec.paths["/audit"].get.responses).toHaveProperty("400");
		expect(spec.components.schemas.Budget.required).toEqual(["currency", "ceilingAmount"]);
		expect(spec.components.schemas.Budget.properties).not.toHaveProperty("monthlyLimitUsd");
		for (const write of [spec.paths["/ai-budget/global"].put, spec.paths["/ai-budget/accounts/{userId}"].put])
		{
			expect(write.responses).toHaveProperty("204");
			expect(write.responses).not.toHaveProperty("200");
		}
	});
});
