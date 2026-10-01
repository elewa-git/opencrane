import { describe, expect, it } from "vitest";

import { _BudgetRows, _BudgetValue, _UsageRows } from "../usage.mapper";

describe("usage and budget presentation mappers", function _Mappers()
{
	it("keeps accounts and currencies distinct and preserves zero and small charges", function _UsageValues()
	{
		const base = { userId: "same-account", inputTokens: 0, outputTokens: 12345, totalTokens: 12345, currency: "USD", totalCost: 0.000001 };
		const rows = _UsageRows([{ ...base, budgetCeiling: 0 }, { ...base, currency: "KES", totalCost: 0 }]);
		expect(rows).toEqual([
			{ id: '["same-account","USD"]', userId: "same-account", currency: "USD", inputTokens: "0", outputTokens: "12,345", totalTokens: "12,345", totalCost: "0.000001", budgetCeiling: "0" },
			{ id: '["same-account","KES"]', userId: "same-account", currency: "KES", inputTokens: "0", outputTokens: "12,345", totalTokens: "12,345", totalCost: "0", budgetCeiling: null },
		]);
		expect(rows[0].id).not.toBe(rows[1].id);
		expect(rows[0]).not.toHaveProperty("percentage");
		expect(rows[0]).not.toHaveProperty("month");
	});

	it("keeps an absent global setting unknown and the returned zero explicit", function _GlobalBudget()
	{
		expect(_BudgetValue(null)).toBeNull();
		expect(_BudgetValue({ currency: "USD", ceilingAmount: 0 })).toBe("USD 0");
		expect(_BudgetValue({ currency: "KES", ceilingAmount: 1250.5 })).toBe("KES 1,250.5");
	});

	it("maps configured overrides without creating rows for other accounts", function _AccountBudgets()
	{
		expect(_BudgetRows([{ userId: "a", currency: "USD", ceilingAmount: 0 }, { userId: "a", currency: "EUR", ceilingAmount: 12.5 }])).toEqual([{ id: '["a","USD"]', userId: "a", budget: "USD 0" }, { id: '["a","EUR"]', userId: "a", budget: "EUR 12.5" }]);
		expect(_UsageRows(null)).toEqual([]);
		expect(_UsageRows([])).toEqual([]);
		expect(_BudgetRows(null)).toEqual([]);
		expect(_BudgetRows([])).toEqual([]);
	});
});
