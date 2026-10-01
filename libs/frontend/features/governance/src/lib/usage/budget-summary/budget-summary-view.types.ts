/** Displays a returned account override without asserting that runtime enforcement uses it. */
export interface BudgetAccountRowView
{
	/** Identifies the returned override for stable rendering. */
	readonly id: string;
	/** Identifies the account included in the response. */
	readonly userId: string;
	/** Includes the returned amount and currency, or null when unknown. */
	readonly budget: string | null;
}
