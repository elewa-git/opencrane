import type { RuntimeCandidate, RuntimeEventCandidate } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";
import { __MarkToolInvocationSucceededByCoordinatesInTransaction } from "@opencrane/backend/server/iam/authorization";

import type { RuntimeTerminalReporter } from "./prisma-runtime-dispatch-authority.types.js";

/** Transaction shape already owned by the injected canonical terminal-reporting port. */
type RuntimeCandidateTransaction = Parameters<RuntimeTerminalReporter["reportInTransaction"]>[0];

/** Return whether this candidate needs the injected canonical run-terminal authority. */
export function _RuntimeCandidateRequiresTerminalReporter(candidate: RuntimeCandidate): boolean
{
	return _TerminalRuntimeEvent(candidate) !== null;
}

/**
 * Applies the durable side effects selected by an already-admitted runtime event.
 *
 * The caller retains the candidate fence and accepted-id append. This transaction-scoped adapter
 * owns only canonical terminal reporting and digest-only tool-completion persistence; it must never
 * dispatch external I/O or advance the runtime command stream.
 */
export async function _ApplyRuntimeCandidateSideEffects(transaction: RuntimeCandidateTransaction, candidate: RuntimeCandidate, runId: string, attempt: number, terminalReporter: RuntimeTerminalReporter | null): Promise<string | null>
{
	const terminal = _TerminalRuntimeEvent(candidate);
	if (terminal !== null && terminalReporter === null) return "terminal_reporter_unavailable";
	if (terminal !== null && terminalReporter !== null)
	{
		const report = await terminalReporter.reportInTransaction(transaction, { runId, attempt, eventType: terminal });
		if (report.outcome === "denied") return report.reason ?? "terminal_report_denied";
	}
	if (candidate.kind !== "event" || candidate.eventType !== "tool.completed") return null;
	const completion = _ToolCompletionPayload(candidate.payload);
	if (completion === null) return "invalid_tool_completion";
	const marked = await __MarkToolInvocationSucceededByCoordinatesInTransaction(transaction, { runId, attempt, toolInvocationId: completion.toolInvocationId }, { resultDigest: completion.resultDigest });
	return marked.status === "succeeded" ? null : "tool_completion_conflict";
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

/** Return a terminal event type only for workload outcomes the server lets a runtime report. */
function _TerminalRuntimeEvent(candidate: RuntimeCandidate): "run.completed" | "run.failed" | null
{
	if (candidate.kind !== "event") return null;
	const event = candidate as RuntimeEventCandidate;
	if (event.eventType === "run.completed" || event.eventType === "run.failed") return event.eventType;
	return null;
}
