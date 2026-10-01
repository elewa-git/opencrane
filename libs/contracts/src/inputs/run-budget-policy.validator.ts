import { z } from "zod";

import type { RunBudgetPolicy } from "./run-budget-policy.types";

/** Requires every saved ceiling and rejects extra fields that the compiled contract cannot enforce. */
const _runBudgetPolicySchema: z.ZodType<RunBudgetPolicy> = z.object({
	maxModelTurns: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	maxCompletionTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	maxCostUsdMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
	maxToolInvocations: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	maxLoopIterations: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
	wallClockDeadlineEpochMs: z.number().int().positive().max(8_640_000_000_000_000),
}).strict();

/**
 * Validates a complete saved allowance without reading the clock or filling in missing limits.
 * Expired deadlines remain valid historical data; the effect owner checks whether time remains.
 */
export function ___ParseRunBudgetPolicy(value: unknown): RunBudgetPolicy
{
	return _runBudgetPolicySchema.parse(value);
}
