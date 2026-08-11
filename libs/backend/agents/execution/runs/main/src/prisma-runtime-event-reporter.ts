import { AgentRunState, Prisma } from "@prisma/client";

import { RunEventTypes } from "@opencrane/models/agents";
import { ___ParseAgUiA2uiEnvelope } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { PrismaRuntimeTerminalReporter } from "./prisma-runtime-terminal-reporter.js";
import type { RuntimeEventAppendRepository, RuntimeEventAppendUnitOfWork, RuntimeEventReportCommand, RuntimeEventReporter, RuntimeEventReportResult } from "./runtime-event-reporter.types.js";

/** Canonical runtime event names a workload may propose. Server-owned lifecycle events stay absent. */
const _RUNTIME_EVENT_TYPES = new Set<string>([RunEventTypes.MessageStarted, RunEventTypes.MessageDelta, RunEventTypes.MessageCompleted, RunEventTypes.ToolRequested, RunEventTypes.ToolStarted, RunEventTypes.ToolCompleted, RunEventTypes.ToolFailed, RunEventTypes.RunUsage, RunEventTypes.RunError, RunEventTypes.A2uiRenderingBegun, RunEventTypes.A2uiSurfaceUpdated, RunEventTypes.A2uiDataModelUpdated, RunEventTypes.RunCompleted, RunEventTypes.RunFailed]);
const _A2UI_EVENT_TYPES = new Set<string>([RunEventTypes.A2uiRenderingBegun, RunEventTypes.A2uiSurfaceUpdated, RunEventTypes.A2uiDataModelUpdated]);
const _SECRET_FIELD = /token|secret|password|authorization|cookie|credential|proof|private.?key/iu;

/** Production reporter that validates runtime proposals before canonical persistence. */
export class PrismaRuntimeEventReporter implements RuntimeEventReporter
{
	/** Validate one proposal and persist it on the admission transaction. */
	async reportInTransaction(transaction: Prisma.TransactionClient, command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>
	{
		if (!_RUNTIME_EVENT_TYPES.has(command.eventType)) return { outcome: "denied", reason: "invalid_event" };
		if (!_PayloadIsSafe(command.payload)) return { outcome: "denied", reason: "invalid_payload" };
		if (command.eventType === RunEventTypes.RunCompleted || command.eventType === RunEventTypes.RunFailed)
		{
			return new PrismaRuntimeTerminalReporter().reportInTransaction(transaction, { runId: command.runId, attempt: command.attempt, eventType: command.eventType });
		}
		return new PrismaRuntimeEventAppendUnitOfWork(transaction).append(command);
	}
}

/** Transaction-owned construction boundary for the append repository. */
class PrismaRuntimeEventAppendUnitOfWork implements RuntimeEventAppendUnitOfWork
{
	/** Exact candidate-admission transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Bind repository construction to the candidate transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Append through one exact transaction-bound repository. */
	async append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult> { return new PrismaRuntimeEventAppendRepository(this._transaction).append(command); }
}

/** Prisma adapter that owns canonical event sequencing and append. */
class PrismaRuntimeEventAppendRepository implements RuntimeEventAppendRepository
{
	/** Exact candidate-admission transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Bind all reads and writes to one candidate transaction. */
	constructor(transaction: Prisma.TransactionClient) { this._transaction = transaction; }
	/** Lock the run, validate coordinates, and append the next contiguous event. */
	async append(command: RuntimeEventReportCommand): Promise<RuntimeEventReportResult>
	{
		const run = await this._transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null || run.attempt !== command.attempt || run.state !== AgentRunState.Running) return { outcome: "denied", reason: "run_not_running" };
		if (run.conversationId === null) return { outcome: "denied", reason: "conversation_unavailable" };
		if (_A2UI_EVENT_TYPES.has(command.eventType) && !_A2uiMatches(command.payload, run.conversationId, run.id)) return { outcome: "denied", reason: "invalid_payload" };
		const maximum = await this._transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await this._transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: command.eventType, payload: command.payload as Prisma.InputJsonValue, occurredAt: new Date() } });
		return { outcome: "reported" };
	}
}

/** Enforce byte, depth, and secret-field bounds before data becomes durable. */
function _PayloadIsSafe(payload: JsonValue): boolean
{
	if (JSON.stringify(payload).length > 32_768) return false;
	function _Visit(value: JsonValue, depth: number): boolean
	{
		if (depth > 12) return false;
		if (Array.isArray(value)) return value.length <= 256 && value.every(function _Safe(item) { return _Visit(item, depth + 1); });
		if (value === null || typeof value !== "object") return typeof value !== "string" || value.length <= 16_384;
		return Object.entries(value).every(function _Safe(entry) { return !_SECRET_FIELD.test(entry[0]) && _Visit(entry[1], depth + 1); });
	}
	return _Visit(payload, 0);
}

/** Require a versioned A2UI envelope bound to the exact durable conversation and run. */
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
