/** Displays a returned usage row without deriving spend across accounts or currencies. */
export interface TokenUsageRowView
{
	/** Identifies the returned row for stable rendering. */
	readonly id: string;
	/** Identifies the account supplied by the response, without inferring a person's name. */
	readonly userId: string;
	/** Names the returned currency; values in different currencies remain separate. */
	readonly currency: string;
	/** Shows returned input tokens, or null when unknown. */
	readonly inputTokens: string | null;
	/** Shows returned output tokens, or null when unknown. */
	readonly outputTokens: string | null;
	/** Shows the returned token total, or null when unknown. */
	readonly totalTokens: string | null;
	/** Shows returned cost in this row's currency, or null when unknown. */
	readonly totalCost: string | null;
	/** Shows a returned budget ceiling, or null when none was supplied. */
	readonly budgetCeiling: string | null;
}
