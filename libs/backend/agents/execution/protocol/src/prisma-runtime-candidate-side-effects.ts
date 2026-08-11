import type { RuntimeCandidate } from "@opencrane/contracts";
import { RunEventTypes } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";
import { __MarkToolInvocationSucceededByCoordinatesInTransaction } from "@opencrane/backend/server/iam/authorization";

import type { RuntimeEventReporter } from "./prisma-runtime-dispatch-authority.types.js";

/** Transaction shape already owned by the injected canonical event-reporting port. */
type RuntimeCandidateTransaction = Parameters<RuntimeEventReporter["reportInTransaction"]>[0];

/** Transaction-aborting denial used when a post-persistence tool fence rejects the candidate. */
export class RuntimeCandidateSideEffectDeniedError extends Error
{
	public constructor(public readonly reason: string)
	{
		super(reason);
		this.name = "RuntimeCandidateSideEffectDeniedError";
	}
}

/** Return whether this candidate needs the injected canonical run-event authority. */
export function _RuntimeCandidateRequiresEventReporter(candidate: RuntimeCandidate): boolean
{
	return "eventType" in candidate;
}

/**
 * Applies the durable side effects selected by an already-admitted runtime event.
 *
 * The caller retains the candidate fence and accepted-id append. This transaction-scoped adapter
 * owns only canonical event reporting and digest-only tool-completion persistence; it must never
 * dispatch external I/O or advance the runtime command stream.
 */
export async function _ApplyRuntimeCandidateSideEffects(transaction: RuntimeCandidateTransaction, candidate: RuntimeCandidate, runId: string, attempt: number, eventReporter: RuntimeEventReporter | null): Promise<string | null>
{
	if (!("eventType" in candidate)) return null;
	if (eventReporter === null) return "event_reporter_unavailable";
	const completion = candidate.eventType === RunEventTypes.ToolCompleted ? _ToolCompletionPayload(candidate.payload) : undefined;
	if (completion === null) return "invalid_tool_completion";
	const report = await eventReporter.reportInTransaction(transaction, { runId, attempt, eventType: candidate.eventType, payload: candidate.payload });
	if ("reason" in report) return report.reason ?? "event_report_denied";
	if (candidate.eventType !== RunEventTypes.ToolCompleted) return null;
	if (completion === undefined) throw new Error("tool completion validation invariant failed");
	const marked = await __MarkToolInvocationSucceededByCoordinatesInTransaction(transaction, { runId, attempt, toolInvocationId: completion.toolInvocationId }, { resultDigest: completion.resultDigest });
	if (!("receipt" in marked)) throw new RuntimeCandidateSideEffectDeniedError("tool_completion_conflict");
	return null;
}

/** Validate an untrusted `tool.completed` payload into digest-only completion coordinates. */
function _ToolCompletionPayload(payload: JsonValue): { readonly toolInvocationId: string; readonly resultDigest: string } | null
{
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
	const record = payload as { readonly [key: string]: JsonValue };
	const toolInvocationId = record["toolInvocationId"];
	const resultDigest = record["resultDigest"];
	if (typeof toolInvocationId !== "string" || toolInvocationId.trim().length === 0 || toolInvocationId.length > 256) return null;
	if (typeof resultDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(resultDigest)) return null;
	return { toolInvocationId, resultDigest };
}
