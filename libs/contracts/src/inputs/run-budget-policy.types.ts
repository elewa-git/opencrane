/**
 * The complete allowance saved when one run is admitted.
 *
 * Admission replaces the revision's relative duration with one absolute deadline. Compilation
 * and recovery copy these values; neither may supply defaults or extend the saved allowance.
 */
export type RunBudgetPolicy = {
	/** Total model requests, including the final answer after any tool results. */
	readonly maxModelTurns: number;
	/** Total generated completion tokens across those requests; input tokens are not counted here. */
	readonly maxCompletionTokens: number;
	/** Extra revision spend cap in micro-US-dollars, or null to use the existing frozen server cap. */
	readonly maxCostUsdMicros: number | null;
	/** Total admitted external tool invocations; zero permits text responses only. */
	readonly maxToolInvocations: number;
	/** Distinct saved tool-result cycles that may feed a later model step; retries and waits do not count again. */
	readonly maxLoopIterations: number;
	/** Original absolute run deadline in epoch milliseconds, computed only at admission. */
	readonly wallClockDeadlineEpochMs: number;
};
