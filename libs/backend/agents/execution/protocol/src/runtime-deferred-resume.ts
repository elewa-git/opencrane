import { ApprovalRequestState, type Prisma } from "@prisma/client";

import type { DeferredToolResumeResult, ResumeAttemptCommand } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { RuntimeDeferredResumeLoad } from "./runtime-deferred-resume.types.js";

/** Parse a persisted resume payload back into the exact frame it was minted from. */
export function _ParseDeferredResumePayload(payload: Prisma.JsonValue | null): ResumeAttemptCommand | null
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

/** Load every single-use approval marker and pending steering item for one atomic resume body. */
export async function _LoadDeferredResume(transaction: Prisma.TransactionClient, runId: string, attempt: number, inputGeneration: number): Promise<RuntimeDeferredResumeLoad | null>
{
	const approvals = await transaction.approvalRequest.findMany({ where: { runId, attempt, state: ApprovalRequestState.Approved, toolInvocationRowId: { not: null }, resumeTokenHash: { not: null } }, orderBy: { id: "asc" }, include: { toolInvocation: { select: { toolInvocationId: true } } } });
	const steering = await transaction.runtimeSteeringRequest.findMany({ where: { runId, attempt, state: "Pending" }, orderBy: { submittedAt: "asc" } });
	if (approvals.length === 0 && steering.length === 0) return null;
	const deferredToolResults = approvals.map(function _Result(row): DeferredToolResumeResult
	{
		if (row.toolInvocation === null || row.finalArguments === null || typeof row.finalArgumentsDigest !== "string") throw new Error("approved deferred tool request has incomplete resume authority");
		return { approvalRequestId: row.id, decision: "approved", toolInvocationId: row.toolInvocation.toolInvocationId, arguments: row.finalArguments as JsonValue, argumentsDigest: row.finalArgumentsDigest };
	});
	const steeringRequests = steering.map(function _Content(row): JsonValue { return row.content as JsonValue; });
	return { resume: { inputGeneration, deferredToolResults, steeringRequests }, approvalIds: approvals.map(function _Id(row) { return row.id; }), steeringRequestIds: steering.map(function _Id(row) { return row.id; }) };
}
