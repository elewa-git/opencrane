import type { AgentBudget } from "./agent-revision.types";

/** Lists every property that one stored agent budget must own. */
const _AGENT_BUDGET_KEYS = ["maxTurns", "maxTokens", "maxCostUsdMicros", "maxToolInvocations", "maxDurationMs", "maxLoopIterations"] as const satisfies readonly (keyof AgentBudget)[];

/**
 * Parses the limits stored with an agent revision.
 *
 * The parser rejects missing and unknown properties so the revision digest covers every limit that
 * can affect execution. Callers must treat a thrown error as unavailable revision content; they
 * must not supply a default because that would change the limits after publication.
 *
 * Called by: agent revision digesting and agent-service persistence mappers.
 * @param value - Untrusted budget value read from a command or JSON persistence.
 * @returns A copied budget whose required counts are safe integers and whose cost is null or a positive safe integer.
 * @throws {Error} When the value is not the complete stored budget contract.
 * @see AgentBudget
 */
export function __ParseAgentBudget(value: unknown): AgentBudget
{
	if (!_IsExactBudgetObject(value))
		throw new Error("Agent budget must contain the exact stored limit properties");
	if (!_IsPositiveSafeInteger(value.maxTurns)
		|| !_IsPositiveSafeInteger(value.maxTokens)
		|| !_IsNullablePositiveSafeInteger(value.maxCostUsdMicros)
		|| !_IsNonNegativeSafeInteger(value.maxToolInvocations)
		|| !_IsPositiveSafeInteger(value.maxDurationMs)
		|| !_IsPositiveSafeInteger(value.maxLoopIterations))
	{
		throw new Error("Agent budget limits must use their permitted safe integer ranges");
	}
	return Object.freeze({
		maxTurns: value.maxTurns,
		maxTokens: value.maxTokens,
		maxCostUsdMicros: value.maxCostUsdMicros,
		maxToolInvocations: value.maxToolInvocations,
		maxDurationMs: value.maxDurationMs,
		maxLoopIterations: value.maxLoopIterations,
	});
}

/** Checks that a value owns every budget property and no extension. */
function _IsExactBudgetObject(value: unknown): value is { readonly [Key in keyof AgentBudget]: unknown }
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const keys = Object.keys(value);
	return keys.length === _AGENT_BUDGET_KEYS.length
		&& _AGENT_BUDGET_KEYS.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

/** Checks a count that must permit at least one operation. */
function _IsPositiveSafeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Checks a count whose zero value disables that operation. */
function _IsNonNegativeSafeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Checks an optional extra cost cap without turning null into unlimited provider spend. */
function _IsNullablePositiveSafeInteger(value: unknown): value is number | null
{
	return value === null || _IsPositiveSafeInteger(value);
}
