import type { DeferredToolResumeResult, ResumeAttemptCommand } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/** Parse a persisted resume payload back into the exact frame it was minted from. */
export function _ParseDeferredResumePayload(payload: unknown): ResumeAttemptCommand | null
{
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	const record = payload as { readonly [key: string]: JsonValue };
	if (typeof record["inputGeneration"] !== "number" || !("deferredToolResults" in record) || !("steeringRequests" in record)) return null;
	const deferredToolResults = _DeferredToolResults(record["deferredToolResults"]);
	if (deferredToolResults === null) return null;
	return { inputGeneration: record["inputGeneration"], deferredToolResults, steeringRequests: record["steeringRequests"] };
}

/** Parse one persisted array into the sole exact deferred-result wire contract. */
function _DeferredToolResults(value: JsonValue): readonly DeferredToolResumeResult[] | null
{
	if (!Array.isArray(value)) return null;
	const results: DeferredToolResumeResult[] = [];
	for (const item of value)
	{
		if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
		const record = item as { readonly [key: string]: JsonValue };
		const approvalRequestId = record["approvalRequestId"];
		const decision = record["decision"];
		const toolInvocationId = record["toolInvocationId"];
		if (typeof approvalRequestId !== "string" || typeof decision !== "string" || typeof toolInvocationId !== "string") return null;
		if (decision === "approved")
		{
			if (Object.keys(record).length !== 5 || !("arguments" in record) || typeof record["argumentsDigest"] !== "string") return null;
			results.push({ approvalRequestId, decision, toolInvocationId, arguments: record["arguments"], argumentsDigest: record["argumentsDigest"] });
			continue;
		}
		if (Object.keys(record).length !== 4 || typeof record["failureCode"] !== "string") return null;
		if (decision === "denied" && record["failureCode"] === "approval_denied") results.push({ approvalRequestId, decision, toolInvocationId, failureCode: record["failureCode"] });
		else if (decision === "expired" && record["failureCode"] === "approval_expired") results.push({ approvalRequestId, decision, toolInvocationId, failureCode: record["failureCode"] });
		else return null;
	}
	return results;
}
