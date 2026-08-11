import { AgentRunState, AgentRunTerminalReason, Prisma } from "@prisma/client";

import { __DeliverChildRunCompletionInTransaction } from "./prisma-child-run-completion-repository.js";
import type { RuntimeTerminalEventType, RuntimeTerminalReportCommand, RuntimeTerminalReporter, RuntimeTerminalReportResult } from "./runtime-terminal-reporter.types.js";

/** Prisma authority that turns a fenced runtime result into the sole terminal run outcome. */
export class PrismaRuntimeTerminalReporter implements RuntimeTerminalReporter
{
	/** Persist one terminal report with its own stream event and child-to-parent hand-off. */
	async reportInTransaction(transaction: Prisma.TransactionClient, command: RuntimeTerminalReportCommand): Promise<RuntimeTerminalReportResult>
	{
		// Serialise all terminal writers for this run before choosing the next stream sequence.
		await transaction.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${command.runId}, 0))`);
		await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${command.runId} FOR UPDATE`);
		const run = await transaction.agentRun.findUnique({ where: { id: command.runId } });
		if (run === null || run.attempt !== command.attempt || run.state !== AgentRunState.Running) return { outcome: "denied", reason: "run_not_running" };

		const terminal = _terminal(command.eventType);
		const now = new Date();
		const updated = await transaction.agentRun.updateMany({ where: { id: run.id, attempt: run.attempt, state: AgentRunState.Running }, data: { state: terminal.state, terminalReason: terminal.reason, finishedAt: now } });
		if (updated.count !== 1) return { outcome: "denied", reason: "run_not_running" };

		if (run.conversationId !== null)
		{
			const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
			await transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: command.eventType, payload: { terminalReason: terminal.payloadReason }, occurredAt: now } });
		}

		// A terminal child must notify its parent in this same transaction; the delivery helper records a
		// durable suppression instead when the parent stream is intentionally unavailable.
		if (run.parentRunId !== null) await __DeliverChildRunCompletionInTransaction(transaction, { childRunId: run.id });
		return { outcome: "reported" };
	}
}

/** Map the only workload-reportable terminal types to canonical durable lifecycle values. */
function _terminal(eventType: RuntimeTerminalEventType): { readonly state: "Completed" | "Failed"; readonly reason: AgentRunTerminalReason; readonly payloadReason: "success" | "runtime_failure" }
{
	if (eventType === "run.completed") return { state: AgentRunState.Completed, reason: AgentRunTerminalReason.Success, payloadReason: "success" };
	return { state: AgentRunState.Failed, reason: AgentRunTerminalReason.RuntimeFailure, payloadReason: "runtime_failure" };
}
