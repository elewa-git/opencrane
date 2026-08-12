import { AgentRunState, Prisma } from "@prisma/client";

import { RunEventTypes } from "@opencrane/models/agents";
import { ___ParseAgUiA2uiEnvelope } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { PrismaRuntimeTerminalReporter } from "./prisma-runtime-terminal-reporter.js";
import { _RuntimeEventPayloadIsSafe } from "./runtime-event-payload.js";
import type { RuntimeEventAppendRepository, RuntimeEventAppendUnitOfWork, RuntimeEventReportCommand, RuntimeEventReporter, RuntimeEventReportResult } from "./runtime-event-reporter.types.js";

/** The event names a workload is allowed to propose. Server-owned lifecycle events are deliberately not in this list. */
const _RUNTIME_EVENT_TYPES = new Set<string>([RunEventTypes.RunStarted, RunEventTypes.RunResumed, RunEventTypes.MessageStarted, RunEventTypes.MessageDelta, RunEventTypes.MessageCompleted, RunEventTypes.ToolRequested, RunEventTypes.RunUsage, RunEventTypes.RunError, RunEventTypes.A2uiRenderingBegun, RunEventTypes.A2uiSurfaceUpdated, RunEventTypes.A2uiDataModelUpdated, RunEventTypes.RunCompleted, RunEventTypes.RunFailed]);
const _A2UI_EVENT_TYPES = new Set<string>([RunEventTypes.A2uiRenderingBegun, RunEventTypes.A2uiSurfaceUpdated, RunEventTypes.A2uiDataModelUpdated]);

/**
 * Validates what a workload proposes as a run event, then writes it.
 *
 * Anything outside the allowed event names or the payload contract is refused rather than
 * written. The two terminal event types are not appended here at all — they are routed to
 * {@link PrismaRuntimeTerminalReporter}, which owns the run's terminal state.
 *
 * Called by: `execution/protocol/src/production-runtime-dispatch.ts`, which passes this into
 * `PrismaRuntimeDispatchAuthority` as its event reporter.
 *
 * @implements RuntimeEventReporter
 */
export class PrismaRuntimeEventReporter implements RuntimeEventReporter
{
	/** Validate one proposal and persist it on the admission transaction. */
	async reportInTransaction(transaction: Prisma.TransactionClient, command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>
	{
		if (!_RUNTIME_EVENT_TYPES.has(command.eventType)) return { outcome: "denied", reason: "invalid_event" };
		if (!_RuntimeEventPayloadIsSafe(command.eventType, command.payload)) return { outcome: "denied", reason: "invalid_payload" };
		if (command.eventType === RunEventTypes.RunCompleted || command.eventType === RunEventTypes.RunFailed)
		{
			return new PrismaRuntimeTerminalReporter().reportInTransaction(transaction, { runId: command.runId, attempt: command.attempt, eventType: command.eventType });
		}
		return new PrismaRuntimeEventAppendUnitOfWork(transaction).append(command);
	}
}

/** Builds the repository that appends the event, bound to the caller's transaction. */
class PrismaRuntimeEventAppendUnitOfWork implements RuntimeEventAppendUnitOfWork
{
	/** The caller's transaction for admitting this candidate. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Keeps the repository on the caller's transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Appends the event through a repository bound to that transaction. */
	async append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult> { return new PrismaRuntimeEventAppendRepository(this._transaction).append(command); }
}

/** Prisma adapter that numbers the event and writes it. */
class PrismaRuntimeEventAppendRepository implements RuntimeEventAppendRepository
{
	/** The caller's transaction for admitting this candidate. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Bind all reads and writes to one candidate transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Reads the run, checks it is on the expected attempt and Running, then appends the event at the next sequence number. */
	async append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>
	{
		const run = await this._transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null || run.attempt !== command.attempt) return { outcome: "denied", reason: "run_not_running" };
		if (command.eventType === RunEventTypes.RunStarted)
		{
			const startedAt = new Date();
			const transitioned = await this._transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Assigned }, data: { state: AgentRunState.Running, startedAt } });
			if (transitioned.count !== 1) return { outcome: "denied", reason: "run_not_assigned" };
		}
		else if (run.state !== AgentRunState.Running) return { outcome: "denied", reason: "run_not_running" };
		// Managed and scheduled runs intentionally have no conversation stream. Their lifecycle still
		// advances under this authority, while user-visible runtime output remains conversation-bound.
		if (run.conversationId === null)
		{
			return command.eventType === RunEventTypes.RunStarted || command.eventType === RunEventTypes.RunResumed ? { outcome: "reported" } : { outcome: "denied", reason: "conversation_unavailable" };
		}
		if (_A2UI_EVENT_TYPES.has(command.eventType) && !_A2uiMatches(command.payload, run.conversationId, run.id)) return { outcome: "denied", reason: "invalid_payload" };
		const maximum = await this._transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await this._transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: command.eventType, payload: command.payload as Prisma.InputJsonValue, occurredAt: new Date() } });
		return { outcome: "reported" };
	}
}

/**
 * Requires a versioned A2UI envelope whose conversation and run match this run's own.
 *
 * The version is OpenCrane's own envelope version (`opencrane.a2ui.v1`), not an upstream A2UI
 * version. Rejecting a mismatched conversation or run is what stops one run's rendering payload
 * from being written into another conversation's stream.
 *
 * @see https://a2ui.org/specification/v0.8-a2ui/ — the A2UI specification revision this envelope
 * carries a payload for; upstream marks v0.8 legacy, and this repo pins `@a2ui/web_core` 0.10.3.
 * @see https://docs.ag-ui.com — AG-UI, the event stream the envelope is delivered on; this repo
 * pins `@ag-ui/core` 0.0.57.
 */
function _A2uiMatches(payload: JsonValue, conversationId: string, runId: string): boolean
{
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
	try
	{
		const envelope = ___ParseAgUiA2uiEnvelope((payload as { readonly [key: string]: JsonValue })["a2ui"]);
		return envelope.conversationId === conversationId && envelope.runId === runId;
	}
	catch
	{
		return false;
	}
}
