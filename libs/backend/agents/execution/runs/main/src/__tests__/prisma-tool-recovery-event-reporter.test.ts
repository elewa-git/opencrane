import { AgentRunState, type Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { RunEventTypes } from "@opencrane/models/agents";

import { PrismaToolRecoveryEventReporter } from "../prisma-tool-recovery-event-reporter";

/** Build the transaction seam needed by the canonical recovery reporter. */
function _transaction(run: unknown): { readonly transaction: Prisma.TransactionClient; readonly create: ReturnType<typeof vi.fn> }
{
	const create = vi.fn().mockResolvedValue({ id: "event-1" });
	return { transaction: { agentRun: { findUnique: vi.fn().mockResolvedValue(run) }, conversationRunEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 4 } }), create } } as unknown as Prisma.TransactionClient, create };
}

describe("PrismaToolRecoveryEventReporter", function _suite()
{
	it("persists only fixed safe recovery evidence for the exact recovery-required attempt", async function _persists()
	{
		const { transaction, create } = _transaction({ id: "run-1", attempt: 2, state: AgentRunState.RecoveryRequired, conversationId: "conversation-1" });
		await expect(new PrismaToolRecoveryEventReporter().appendInTransaction(transaction, { runId: "run-1", expectedAttempt: 2, toolInvocationId: "tool-1", preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: "unknown_after_dispatch" })).resolves.toBe(true);
		expect(create).toHaveBeenCalledWith({ data: { conversationId: "conversation-1", runId: "run-1", attempt: 2, sequence: 5, type: RunEventTypes.ToolRecoveryRequired, payload: { toolInvocationId: "tool-1", toolCallId: "tool-1", expectedAttempt: 2, preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: "unknown_after_dispatch" }, occurredAt: expect.any(Date) } });
	});

	it("rejects stale attempts and wrong run states", async function _rejects()
	{
		const { transaction, create } = _transaction({ id: "run-1", attempt: 3, state: AgentRunState.Running, conversationId: "conversation-1" });
		await expect(new PrismaToolRecoveryEventReporter().appendInTransaction(transaction, { runId: "run-1", expectedAttempt: 2, toolInvocationId: "tool-1", preparationRetryCount: 1, preparationRetryLimit: 3, providerOutcome: "unknown_after_dispatch" })).resolves.toBe(false);
		expect(create).not.toHaveBeenCalled();
	});
});
