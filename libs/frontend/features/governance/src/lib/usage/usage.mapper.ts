import type { GovernanceAccountBudgets, GovernanceBudget, GovernanceTokenUsageRows } from "@opencrane/state/governance";

import type { BudgetAccountRowView } from "./budget-summary/budget-summary-view.types";
import type { TokenUsageRowView } from "./token-usage-summary/token-usage-view.types";

/** Formats each account and currency separately; the API does not establish a reporting period. */
export function _UsageRows(rows: GovernanceTokenUsageRows | null): readonly TokenUsageRowView[]
{
	return (rows ?? []).map(function _Row(row)
	{
		return { id: JSON.stringify([row.userId, row.currency]), userId: row.userId, currency: row.currency, inputTokens: _number(row.inputTokens), outputTokens: _number(row.outputTokens), totalTokens: _number(row.totalTokens), totalCost: _number(row.totalCost), budgetCeiling: row.budgetCeiling === undefined ? null : _number(row.budgetCeiling) };
	});
}

/** Preserves an explicit zero and the server's currency without making an enforcement claim. */
export function _BudgetValue(budget: GovernanceBudget | null): string | null
{
	if (budget === null)
		return null;
	return `${budget.currency} ${_number(budget.ceilingAmount)}`;
}

/** Presents configured overrides rather than implying a complete organisation directory. */
export function _BudgetRows(rows: GovernanceAccountBudgets | null): readonly BudgetAccountRowView[]
{
	return (rows ?? []).map(function _Row(row)
	{
		return { id: JSON.stringify([row.userId, row.currency]), userId: row.userId, budget: _BudgetValue(row) ?? "Unknown" };
	});
}

/** Keeps fractional costs visible rather than rounding small recorded charges to zero. */
function _number(value: number): string
{
	return value.toLocaleString("en-US", { maximumFractionDigits: 20 });
}
