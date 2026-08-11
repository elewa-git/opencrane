import type { RuntimeCandidate } from "@opencrane/contracts";
import { RunEventTypes } from "@opencrane/models/agents";

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
	if (candidate.eventType === RunEventTypes.ToolStarted || candidate.eventType === RunEventTypes.ToolCompleted || candidate.eventType === RunEventTypes.ToolFailed) return "runtime_tool_lifecycle_not_authoritative";
	const report = await eventReporter.reportInTransaction(transaction, { runId, attempt, eventType: candidate.eventType, payload: candidate.payload });
	if ("reason" in report) return report.reason ?? "event_report_denied";
	return null;
}
