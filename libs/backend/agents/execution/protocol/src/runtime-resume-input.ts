import type { ResumeAttemptCommand, RuntimeToolResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Parse a persisted resume payload back into the exact frame it was minted from. */
export function _ParseRuntimeResumeInput(payload: unknown): ResumeAttemptCommand | null
{
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	const record = payload as { readonly [key: string]: JsonValue };
	if (Object.keys(record).length !== 3 || typeof record["inputGeneration"] !== "number" || !("toolResults" in record) || !("steeringRequests" in record)) return null;
	const toolResults = _ToolResults(record["toolResults"]);
	if (toolResults === null || !Array.isArray(record["steeringRequests"])) return null;
	return { inputGeneration: record["inputGeneration"], toolResults, steeringRequests: record["steeringRequests"] };
}

/** Parse one persisted array into the sole exact saved-result wire contract. */
function _ToolResults(value: JsonValue): readonly RuntimeToolResult[] | null
{
	if (!Array.isArray(value)) return null;
	const results: RuntimeToolResult[] = [];
	for (const item of value)
	{
		if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
		const record = item as { readonly [key: string]: JsonValue };
		const toolInvocationId = record["toolInvocationId"];
		if (typeof toolInvocationId !== "string") return null;
		if (record["outcome"] === "succeeded")
		{
			if (Object.keys(record).length !== 3 || !("result" in record)) return null;
			results.push({ toolInvocationId, outcome: "succeeded", result: record["result"] });
			continue;
		}
		if (record["outcome"] !== "failed" || Object.keys(record).length !== 3 || typeof record["failureCode"] !== "string" || record["failureCode"].length === 0) return null;
		results.push({ toolInvocationId, outcome: "failed", failureCode: record["failureCode"] });
	}
	return results;
}
