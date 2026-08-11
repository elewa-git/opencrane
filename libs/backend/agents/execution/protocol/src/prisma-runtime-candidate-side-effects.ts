import type { RuntimeCandidate } from "@opencrane/contracts";
import { RunEventTypes } from "@opencrane/models/agents";

import type { RuntimeEventReporter } from "./prisma-runtime-dispatch-authority.types.js";

/** Transaction shape already owned by the injected event-reporting port. */
type RuntimeCandidateTransaction = Parameters<RuntimeEventReporter["reportInTransaction"]>[0];

/**
 * Tool events the runtime may ask for but is not trusted to record.
 *
 * The tool worker is the only writer of a tool's start, success, and failure, because only it
 * knows what the provider actually did. A runtime claiming these could report a tool call that
 * never ran.
 */
const _WORKER_OWNED_EVENT_TYPES: ReadonlySet<string> = new Set<string>([RunEventTypes.ToolStarted, RunEventTypes.ToolCompleted, RunEventTypes.ToolFailed]);

/** Transaction-aborting denial used when a post-persistence tool fence rejects the candidate. */
export class RuntimeCandidateSideEffectDeniedError extends Error
{
	public constructor(public readonly reason: string)
	{
		super(reason);
		this.name = "RuntimeCandidateSideEffectDeniedError";
	}
}

/** Return whether this candidate needs the injected run-event authority. */
export function _RuntimeCandidateRequiresEventReporter(candidate: RuntimeCandidate): boolean
{
	return "eventType" in candidate;
}

/**
 * Records the run event an admitted candidate asks for, inside the caller's transaction.
 *
 * Returns `null` when there is nothing to refuse, or a reason string that tells the caller to
 * reject the candidate and roll the transaction back. The caller still owns the candidate fence
 * and the accepted-id append; this function must never call out to a provider or advance the
 * runtime command stream.
 */
export async function _ApplyRuntimeCandidateSideEffects(transaction: RuntimeCandidateTransaction, candidate: RuntimeCandidate, runId: string, attempt: number, sourceIsStartAttempt: boolean, eventReporter: RuntimeEventReporter | null): Promise<string | null>
{
	// 1. A candidate that carries no event has no side effect to apply.
	if (!("eventType" in candidate)) return null;

	// 2. Writing an event needs the authority the composition root injects.
	if (eventReporter === null) return "event_reporter_unavailable";

	// 3. Refuse the events only the tool worker may write.
	if (_WORKER_OWNED_EVENT_TYPES.has(candidate.eventType)) return "runtime_tool_lifecycle_not_authoritative";

	// 4. Persist the event, and treat any refusal as this candidate's refusal.
	const report = await eventReporter.reportInTransaction(transaction, { runId, attempt, sourceIsStartAttempt, eventType: candidate.eventType, payload: candidate.payload });
	if (report.outcome === "denied") return report.reason ?? "event_report_denied";
	return null;
}
