import { AgentRunState, Prisma } from "@prisma/client";

import type { ToolInvocationRecoveryEvent, ToolInvocationRecoveryEventSink } from "@opencrane/backend/server/iam/authorization";
import { RunEventTypes } from "@opencrane/models/agents";

/** Canonical run-event sink for a ToolInvocation recovery transition. */
export class PrismaToolRecoveryEventReporter implements ToolInvocationRecoveryEventSink
{
	/** Append one bounded recovery event while the invocation owner holds the same transaction. */
	async appendInTransaction(transaction: Prisma.TransactionClient, event: ToolInvocationRecoveryEvent): Promise<boolean>
	{
		// 1. Recheck the exact recovery-required attempt so a stale invocation cannot publish an event.
		const run = await transaction.agentRun.findUnique({ where: { id: event.runId } });
		if (run === null || run.attempt !== event.expectedAttempt || run.state !== AgentRunState.RecoveryRequired) return false;

		// 2. Managed runs have no conversation stream; the durable run state remains authoritative.
		if (run.conversationId === null) return true;

		// 3. Append the fixed safe evidence as the next canonical event in the held transaction.
		const maximum = await transaction.conversationRunEvent.aggregate({ where: { runId: run.id }, _max: { sequence: true } });
		await transaction.conversationRunEvent.create({ data: { conversationId: run.conversationId, runId: run.id, sequence: (maximum._max.sequence ?? 0) + 1, type: RunEventTypes.ToolRecoveryRequired, payload: { toolInvocationId: event.toolInvocationId, toolCallId: event.toolInvocationId, expectedAttempt: event.expectedAttempt, preparationRetryCount: event.preparationRetryCount, preparationRetryLimit: event.preparationRetryLimit, providerOutcome: event.providerOutcome }, occurredAt: new Date() } });
		return true;
	}
}
