import type { ResumeAttemptCommand, RuntimeToolResult } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/**
 * Parse a saved resume payload back into the exact command body it came from.
 *
 * Used when a resume command has to be sent again: the body cannot be rebuilt from the tool-result
 * rows, because those were marked consumed when the command was first saved. Parsing is strict -
 * exact key counts, exact outcome shapes - so a row that was edited, or written by an older
 * version, is refused rather than sent as a slightly different command.
 *
 * Called by: `_storedCommandExtras` in prisma-runtime-dispatch-authority.ts.
 *
 * @param payload - The JSON payload stored on the dispatched-command row.
 * @returns The resume body, or null when the payload does not match the wire shape exactly. Null
 * stops the re-send: no command goes out, rather than a changed one.
 * @see PrismaRuntimeDispatchAuthority for the byte-for-byte redelivery rule this protects.
 */
export function _ParseRuntimeResumeInput(payload: unknown): ResumeAttemptCommand | null
{
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	const record = payload as { readonly [key: string]: JsonValue };
	if (Object.keys(record).length !== 3 || typeof record["inputGeneration"] !== "number" || !("toolResults" in record) || !("steeringRequests" in record)) return null;
	const toolResults = _ToolResults(record["toolResults"]);
	if (toolResults === null || !Array.isArray(record["steeringRequests"])) return null;
	return { inputGeneration: record["inputGeneration"], toolResults, steeringRequests: record["steeringRequests"] };
}

/** Parse the saved array into tool results, returning null when any entry has the wrong shape. */
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
